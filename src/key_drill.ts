import { z } from 'zod';

export const drillInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), exerciseId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('report'), keyId: z.string().min(1), buildId: z.string().min(1), diagnostic: z.string().min(1) }).strict(),
  z.object({ action: z.literal('rotate'), keyId: z.string().min(1), operationId: z.string().uuid(), grace_hours: z.number().int().min(0).max(24) }).strict(),
  z.object({ action: z.literal('confirm'), keyId: z.string().min(1), releaseId: z.string().min(1), replacementInstalled: z.literal(true), smokeBuildPassed: z.literal(true), logsReviewed: z.literal(true) }).strict()
]);

type Envelope = { ok: boolean; data?: unknown; error?: unknown; metadata?: unknown };
export class DrillError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super('Drill request rejected');
    this.status = status;
    this.detail = detail;
  }
}

export function makeControlPlane(key: string, baseURL: string) {
  return async (method: string, path: string, body?: object): Promise<unknown> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${baseURL}${path}`, {
        method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const envelope = await response.json() as Envelope;
      if (response.status === 429 && attempt < 3) {
        const retry = response.headers.get('Retry-After');
        const seconds = retry === null ? NaN : Number(retry);
        const delay = retry === null ? 0 : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
        await new Promise(resolve => setTimeout(resolve, Math.max(250 * 2 ** attempt, Number.isFinite(delay) ? delay : 0)));
        continue;
      }
      if (!envelope.ok) throw new DrillError(response.status >= 400 ? response.status : 400, envelope.error);
      if (!response.ok) throw new DrillError(502, 'Unexpected upstream response');
      return envelope.data;
    }
    throw new DrillError(429, 'Retry allowance exhausted');
  };
}

type Call = ReturnType<typeof makeControlPlane>;
type Evidence = { buildId: string; diagnostic: string; stage: 'reported' | 'rotated' | 'confirmed' };
export function makeDrill(call: Call, activeKeyId: string) {
  const exercises = new Set<string>();
  const evidence = new Map<string, Evidence>();
  return async (raw: unknown) => {
    const input = drillInput.parse(raw);
    if (input.action === 'prepare') {
      const data = await call('POST', '/v1/account/keys/create', { name: `lesson-${input.exerciseId}`, idempotency_key: input.exerciseId });
      exercises.add(input.exerciseId);
      return { stage: 'prepared', credential: data };
    }
    if (input.keyId === activeKeyId) throw new DrillError(409, 'Use the temporary exercise credential');
    if (exercises.size === 0) throw new DrillError(409, 'Prepare an exercise first');
    if (input.action === 'report') {
      await call('POST', `/v1/account/keys/suspected_compromise/${encodeURIComponent(input.keyId)}`, { confirmed_leak: true, auto_rotate: false });
      const logs = await call('GET', '/v1/logs/search');
      evidence.set(input.keyId, { stage: 'reported', buildId: input.buildId, diagnostic: input.diagnostic });
      return { stage: 'reported', logs };
    }
    const record = evidence.get(input.keyId);
    if (input.action === 'rotate') {
      if (record?.stage !== 'reported') throw new DrillError(409, 'Report and review the build evidence first');
      const credential = await call('POST', `/v1/account/keys/rotate/${encodeURIComponent(input.keyId)}`, { grace_hours: input.grace_hours, idempotency_key: input.operationId });
      record.stage = 'rotated';
      return { stage: 'rotated', credential };
    }
    if (record?.stage !== 'rotated') throw new DrillError(409, 'Rotate before confirming the release');
    const logs = await call('GET', '/v1/logs/search');
    record.stage = 'confirmed';
    return { stage: record.stage, buildId: record.buildId, diagnostic: record.diagnostic, releaseId: input.releaseId, logs };
  };
}
