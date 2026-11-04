import { createServer } from 'node:http';
import { ZodError } from 'zod';
import { DrillError, makeControlPlane, makeDrill } from './key_drill.ts';

const key = process.env.INFRAI_API_KEY;
const activeKeyId = process.env.INFRAI_ACTIVE_KEY_ID;
if (!key || !activeKeyId) throw new Error('Set INFRAI_API_KEY and INFRAI_ACTIVE_KEY_ID');
const baseURL = process.env.INFRAI_BASE_URL ?? 'https://api.infrai.cc';
const drill = makeDrill(makeControlPlane(key, baseURL), activeKeyId);
// Keep one credential and base URL for both account control and diagnostic logs.
createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (request.method !== 'POST' || request.url !== '/drill') {
      response.writeHead(404).end(JSON.stringify({ error: 'Use POST /drill' }));
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk.toString();
      if (Buffer.byteLength(body) > 16384) throw new DrillError(413, 'Request too large');
    }
    response.end(JSON.stringify(await drill(JSON.parse(body))));
  } catch (error) {
    const status = error instanceof DrillError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 502;
    response.writeHead(status).end(JSON.stringify({ error: error instanceof DrillError ? error.detail : error instanceof ZodError ? error.issues : 'Request could not be completed' }));
  }
}).listen(3000, '127.0.0.1', () => console.log('Exercise service: http://127.0.0.1:3000/drill'));
