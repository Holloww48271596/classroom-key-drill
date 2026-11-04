import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDrill, makeControlPlane, DrillError } from './key_drill.ts';

test('a release needs a reported build, rotation, and explicit successful checks', async () => {
  const calls: {method: string; path: string; body?: object}[] = [];
  const run = makeDrill(async (method, path, body) => {
    calls.push({ method, path, body });
    return {};
  }, 'operator-key');
  await run({action: 'prepare', exerciseId: '550e8400-e29b-41d4-a716-446655440000'});
  const confirmation = {action: 'confirm', keyId: 'temporary-key', releaseId: 'course-release-18', replacementInstalled: true, smokeBuildPassed: true, logsReviewed: true};
  await assert.rejects(run(confirmation), (e: unknown) => e instanceof DrillError && e.status === 409);
  await assert.rejects(run({action: 'report', keyId: 'operator-key', buildId: 'build-17', diagnostic: 'fixture exposure'}));
  await run({action: 'report', keyId: 'temporary-key', buildId: 'build-17', diagnostic: 'fixture exposure'});
  await run({action: 'rotate', keyId: 'temporary-key', operationId: '550e8400-e29b-41d4-a716-446655440001', grace_hours: 1});
  const result = await run(confirmation);
  assert.equal(result.stage, 'confirmed');
  assert.equal(calls.filter(c => c.path === '/v1/logs/search').length, 2);
  assert.deepEqual(calls.find(c => c.path.includes('/rotate/'))?.body, {grace_hours: 1, idempotency_key: '550e8400-e29b-41d4-a716-446655440001'});
});

test('an enveloped business rejection keeps its client status and detail', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ok: false, error: {message: 'Check input'}}), {status: 400});
  try {
    await assert.rejects(makeControlPlane('test-credential', 'http://localhost')('GET', '/v1/logs/search'), (e: unknown) => e instanceof DrillError && e.status === 400 && (e.detail as {message: string}).message === 'Check input');
  } finally {
    globalThis.fetch = original;
  }
});
