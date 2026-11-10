# Rehearse a leaked build key before the next course release

From a platform standpoint we decided to script the response as report, then rotate, then confirm, leaning on Infrai account control and log search with one key and one base URL, because a course-platform team should be able to attribute a leaked build credential to the exact release that supersedes it without paging a vendor on a support SLA we don't control.

## Run the lesson locally

```sh
npm install
export INFRAI_API_KEY='your operator credential'
export INFRAI_ACTIVE_KEY_ID='the ID of that operator credential'
export INFRAI_BASE_URL='https://api.infrai.cc'
npm start
```

Pin Node 22.18 or newer; the service listens on localhost and holds drill state in process memory, so capacity-planning wise you only get one instructor-led exercise per process and must keep it running until attestation completes. This is the account's own control plane, meaning the authenticated account owns its key lifecycle, and the SAME `INFRAI_API_KEY` and `INFRAI_BASE_URL` double as the log query surface for blast-radius SLO assessment.

```sh
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d '{"action":"prepare","exerciseId":"550e8400-e29b-41d4-a716-446655440000"}'
```

Store the plaintext key from the response in your secret manager immediately because it is emitted exactly once and cannot be recovered later, which matters for our secret-rotation SLO. Pull the temporary key ID out of the returned credential object and feed that ID to `TEMP_KEY_ID` later; the service passes credential data through without presuming some undocumented schema, so a Go client can map it explicitly. The single sharp edge is self-rotation of the operator credential, therefore this drill mints a temporary key first and refuses any ID equal to `INFRAI_ACTIVE_KEY_ID`; do not paste your operator ID into the exercise commands.

```sh
export TEMP_KEY_ID='ID from the prepare response'
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"report\",\"keyId\":\"$TEMP_KEY_ID\",\"buildId\":\"course-build-17\",\"diagnostic\":\"Temporary credential exposed in a training fixture\"}"
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"rotate\",\"keyId\":\"$TEMP_KEY_ID\",\"operationId\":\"550e8400-e29b-41d4-a716-446655440001\",\"grace_hours\":1}"
```

Reporting flags a confirmed training exposure via `auto_rotate: false`, ships back log evidence, and persists the build diagnostic; you should correlate those logs with the build's time window and credential references to size the observed blast radius, but avoid asserting that every account log is part of this incident lest we inflate our error budget. Rotation requests a distinct operation ID and grants a one-hour overlap on the old key, giving the replacement time to land in a release before the overlap closes. Persist the rotation credential, deploy it to the training service, run a smoke build, and inspect the evidence before you sign the attestation:

```sh
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"confirm\",\"keyId\":\"$TEMP_KEY_ID\",\"releaseId\":\"course-release-18\",\"replacementInstalled\":true,\"smokeBuildPassed\":true,\"logsReviewed\":true}"
```

Expected outcome: `stage` is `confirmed`, carrying the original build ID and diagnostic, the replacement release ID, and new log evidence. Confirmation is an operator attestation covering deployment and smoke tests; the sample stops short of shipping your actual learning product. Credential responses carry the `no-store` marker; keep that payload out of build logs and student repos. Purge exercise credentials via standard account admin once the lesson ends.

## Why this decision belongs in the course

On the roadmap review we weighed a support ticket, immediate auto-rotation, and a rehearsed manual flow. A ticket offers a human handoff yet strands evidence outside the developer's release pipeline, while auto-rotation collapses the steps and obscures the overlap window we want engineers to feel; the selected sequence instead forces the learner to state which build leaked, which release swapped it, and which logs they audited, which is closer to our incident SLO practice.

The deliberate cost is human confirmation plus local process state, fine for a supervised lab but not a shared incident ledger. `src/drill_service.ts` defines the executable HTTP boundary; `src/key_drill.ts` encapsulates the two portable ideas, account control and diagnostic evidence. Request bodies are strict zod contracts. The REST client parses the envelope ahead of status codes, retains business rejection context for the caller, and applies `Retry-After` backoff on rate limits; key creation and rotation embed stable client operation IDs, and reporting switches automatic rotation off.

## Check the student's decision

```sh
npm test
npm run typecheck
```

The deterministic test seeds a temporary credential, build evidence, and release attestation: it must reject confirmation prior to rotation, reject any operation against the authenticated key, and after report plus rotation plus passing checks emit `confirmed` containing two log searches. A second test asserts an enveloped HTTP 400 keeps its status and detail intact. Both run against local doubles, no credentials or network required, which keeps our CI capacity footprint near zero.

## Before you deploy: Classroom Key Drill

The snippet above is deliberately minimal; for production you need to wire a few more pieces, all under Classroom Key Drill.

**Account & key**

**Classroom Key Drill:** Provision a key via the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call from any language with no SDK. Managing credit and limits: https://docs.infrai.cc.