import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, validatePlan, effectiveChanges } from '../skills/project-align/scripts/records.mjs';

const proof = [{ source: 'https://example.test/check/123', claim: 'Required acceptance passed on the referenced revision.' }];
const record = () => ({ number: 1, title: 'Deliver feature', body: 'Acceptance: verified in production.', state: 'open', labels: [], updatedAt: '2026-09-14', historyHash: 'a' });
function fixture() {
  const data = new Map([[1, record()]]), writes = [];
  return { data, writes, client: {
    labels: async () => ['bug', 'ready'],
    read: async (n) => ({ record: structuredClone(data.get(n)), url: `https://example.test/issues/${n}` }),
    list: async () => [...data.values()],
    update: async (n, changes) => { writes.push(n); Object.assign(data.get(n), changes); },
    create: async (value) => { writes.push('create'); const number = data.size + 1; data.set(number, { ...record(), ...value, number }); return { number }; },
  } };
}
const plan = (operation) => ({ version: 1, repository: 'example/repo', operations: [{ id: 'test-1', kind: 'update-issue', number: 1, expected: record(), changes: { title: 'Clarified feature' }, reason: 'Reflect accepted scope', evidence: proof, ...operation }] });

test('no remote writes on unchanged rerun', async () => {
  const f = fixture(), journal = { entries: {} };
  assert.equal((await applyPlan(plan(), { client: f.client, journal })).outcomes[0].state, 'updated');
  assert.equal((await applyPlan(plan(), { client: f.client, journal })).outcomes[0].state, 'unchanged');
  assert.equal(f.writes.length, 1);
});
test('new comment/history makes expected record stale', async () => {
  const f = fixture(); f.data.get(1).historyHash = 'new-comment';
  await assert.rejects(applyPlan(plan(), { client: f.client }), /changed since inspection/);
  assert.equal(f.writes.length, 0);
});
test('closure requires evidenced acceptance with nothing unresolved', async () => {
  assert.throws(() => validatePlan(plan({ changes: { state: 'closed' } })), /Closure requires/);
  assert.throws(() => validatePlan(plan({ changes: { state: 'closed' }, completion: { criteria: [{ criterion: 'Merged PR', evidence: proof }], unresolved: ['Production'] } })), /Closure requires/);
  const f = fixture();
  await applyPlan(plan({ changes: { state: 'closed' }, completion: { criteria: [{ criterion: 'Verified in production', evidence: proof }], unresolved: [] } }), { client: f.client });
  assert.equal(f.data.get(1).state, 'closed');
});
const closePlan = (changes = {}) => plan({ changes: { state: 'closed', ...changes }, completion: { criteria: [{ criterion: 'Verified in production', evidence: proof }], unresolved: [] } });
test('closure publishes evidence in the issue body and dry run shows the exact payload', async () => {
  const f = fixture(), p = closePlan(), journal = { entries: {} };
  const dryRun = await applyPlan(p, { client: f.client, dryRun: true });
  assert.equal(f.writes.length, 0);
  const changes = dryRun.outcomes[0].changes;
  assert.ok(changes.body.startsWith(record().body + '\n\n'));
  assert.ok(changes.body.includes(p.operations[0].reason));
  assert.ok(changes.body.includes(proof[0].source));
  assert.ok(changes.body.includes('Verified in production'));
  await applyPlan(p, { client: f.client, journal });
  assert.equal(f.data.get(1).body, changes.body);
  assert.equal((await applyPlan(p, { client: f.client, journal })).outcomes[0].state, 'unchanged');
  assert.equal(f.writes.length, 1);
});
test('reopening preserves earlier receipt and publishes the reason for reopening', async () => {
  const f = fixture();
  await applyPlan(closePlan(), { client: f.client });
  const closed = structuredClone(f.data.get(1));
  const p = plan({ id: 'reopen-1', expected: closed, changes: { state: 'open' }, reason: 'New evidence invalidates prior acceptance' });
  const dryRun = await applyPlan(p, { client: f.client, dryRun: true });
  assert.ok(dryRun.outcomes[0].changes.body.startsWith(closed.body));
  await applyPlan(p, { client: f.client });
  assert.equal(f.data.get(1).state, 'open');
  assert.ok(f.data.get(1).body.includes('New evidence invalidates prior acceptance'));
  assert.equal(f.data.get(1).body, dryRun.outcomes[0].changes.body);
  await applyPlan(p, { client: f.client });
  assert.equal(f.writes.length, 2);
});
test('explicit body replacement is the receipt base and existing exact receipt is not repeated', async () => {
  const p = closePlan({ body: 'Acceptance and additional preserved context.' }), op = p.operations[0];
  const changes = effectiveChanges(op);
  assert.ok(changes.body.startsWith(op.changes.body));
  assert.deepEqual(effectiveChanges({ ...op, changes }), changes);
  assert.throws(() => effectiveChanges({ ...op, changes: { ...changes, body: changes.body.replace(op.reason, 'Different reason') } }), /different maintenance receipt/);
});
test('closure evidence must contain actual HTTP source links rather than plain assertions', () => {
  const p = closePlan();
  p.operations[0].completion.criteria[0].evidence = [{ source: 'tests passed', claim: 'Complete' }];
  assert.throws(() => validatePlan(p), /HTTP\(S\) source links/);
});
test('state-only readback without the durable receipt fails verification', async () => {
  const f = fixture(), journal = { entries: {} };
  f.client.update = async (_number, changes) => { f.data.get(1).state = changes.state; };
  await assert.rejects(applyPlan(closePlan(), { client: f.client, journal }), /readback differs/);
  assert.equal(journal.entries['test-1'].state, 'pending');
  assert.deepEqual(journal.entries['test-1'].completion, closePlan().operations[0].completion);
});
test('dry run validates current records without persisting or mutating', async () => {
  const f = fixture();
  await applyPlan(plan(), { client: f.client, dryRun: true, persist: () => { throw Error('should not persist'); } });
  assert.equal(f.writes.length, 0);
});
test('lost update response reconciles remote success without second write', async () => {
  const f = fixture(), journal = { entries: {} }, original = f.client.update;
  f.client.update = async (...args) => { await original(...args); throw Error('connection lost'); };
  await assert.rejects(applyPlan(plan(), { client: f.client, journal }), /connection lost/);
  assert.equal(journal.entries['test-1'].state, 'pending');
  assert.equal(journal.entries['test-1'].reason, plan().operations[0].reason);
  assert.deepEqual(journal.entries['test-1'].evidence, proof);
  await applyPlan(plan(), { client: f.client, journal });
  assert.equal(journal.entries['test-1'].state, 'verified');
  assert.equal(journal.entries['test-1'].reason, plan().operations[0].reason);
  assert.deepEqual(journal.entries['test-1'].evidence, proof);
  assert.equal(f.writes.length, 1);
});
test('interrupted successful closure retains rationale in pending and recovered receipts', async () => {
  const f = fixture(), journal = { entries: {} }, original = f.client.update, persisted = [], p = closePlan();
  f.client.update = async (...args) => { await original(...args); throw Error('connection lost'); };
  const persist = async value => persisted.push(structuredClone(value));
  await assert.rejects(applyPlan(p, { client: f.client, journal, persist }), /connection lost/);
  const pending = persisted[0].entries['test-1'];
  assert.equal(pending.reason, p.operations[0].reason);
  assert.deepEqual(pending.completion, p.operations[0].completion);
  assert.ok(f.data.get(1).body.includes(proof[0].source));
  await applyPlan(p, { client: f.client, journal, persist });
  assert.deepEqual(journal.entries['test-1'], { ...pending, state: 'verified' });
  assert.equal(f.writes.length, 1);
});
test('readback divergence keeps journal pending', async () => {
  const f = fixture(), journal = { entries: {} };
  f.client.update = async () => { f.data.get(1).title = 'Someone else edited'; };
  await assert.rejects(applyPlan(plan(), { client: f.client, journal }), /readback differs/);
  assert.equal(journal.entries['test-1'].state, 'pending');
});
const createPlan = () => ({ version: 1, repository: 'example/repo', operations: [{ id: 'create-1', kind: 'create-issue', title: 'New verified gap', body: 'A bounded follow-up with acceptance.', reason: 'Missing follow-up', evidence: proof }] });
test('create retries find operation marker after uncertain remote success', async () => {
  const f = fixture(), journal = { entries: {} }, original = f.client.create;
  f.client.create = async (...args) => { await original(...args); throw Error('connection lost'); };
  await assert.rejects(applyPlan(createPlan(), { client: f.client, journal }));
  assert.equal(journal.entries['create-1'].reason, 'Missing follow-up');
  assert.equal((await applyPlan(createPlan(), { client: f.client, journal })).outcomes[0].state, 'unchanged');
  assert.equal(journal.entries['create-1'].reason, 'Missing follow-up');
  assert.deepEqual(journal.entries['create-1'].evidence, proof);
  assert.equal(f.writes.length, 1);
});
test('verified creation uses its provider identity when the issue inventory lags', async () => {
  const f = fixture(), journal = { entries: {} };
  await applyPlan(createPlan(), { client: f.client, journal });
  f.client.list = async () => [];
  assert.equal((await applyPlan(createPlan(), { client: f.client, journal })).outcomes[0].state, 'unchanged');
  assert.equal(f.writes.length, 1);
});
test('uncertain creation without remote marker does not blindly retry', async () => {
  const f = fixture(), journal = { entries: {} };
  f.client.create = async () => { throw Error('connection lost'); };
  await assert.rejects(applyPlan(createPlan(), { client: f.client, journal }));
  await assert.rejects(applyPlan(createPlan(), { client: f.client, journal }), /prior remote intent/);
});
test('duplicate title with different operation id is not duplicated', async () => {
  const f = fixture(); f.data.get(1).title = 'New verified gap';
  await assert.rejects(applyPlan(createPlan(), { client: f.client }), /title already exists/);
  assert.equal(f.writes.length, 0);
});
test('unknown labels and reused operation identities fail before writes', async () => {
  const f = fixture();
  await assert.rejects(applyPlan(plan({ changes: { labels: ['made-up'] } }), { client: f.client }), /does not exist/);
  const journal = { entries: {} }; await applyPlan(plan(), { client: f.client, journal });
  await assert.rejects(applyPlan(plan({ reason: 'different intent' }), { client: f.client, journal }), /different intent/);
});
