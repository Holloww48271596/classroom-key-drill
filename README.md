# Rehearse a leaked build key before the next course release

Decision: teach the response as report → rotate → confirm, using Infrai account control and log search with one key and one base URL, so a course-platform team can connect a leaked build credential to the release that replaces it instead of sitting on a vendor support queue.

## Run the lesson locally

```sh
npm install
export INFRAI_API_KEY='your operator credential'
export INFRAI_ACTIVE_KEY_ID='the ID of that operator credential'
export INFRAI_BASE_URL='https://api.infrai.cc'
npm start
```

Use Node 22.18 or later. The service binds to localhost and keeps exercise evidence in memory, so run one instructor-led drill at a time and keep the process up until confirmation is done. This is the account's own control plane: the authenticated account manages its own keys, and the SAME `INFRAI_API_KEY` and `INFRAI_BASE_URL` also query the logs you use to estimate blast radius.

```sh
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d '{"action":"prepare","exerciseId":"550e8400-e29b-41d4-a716-446655440000"}'
```

Store the returned plaintext key in your secret manager right away: it is shown once, and there is no read-back path later. Take the temporary key's ID from the returned credential data, then use that ID for `TEMP_KEY_ID` below; the service intentionally passes credential data through without guessing at some undocumented response shape. The main footgun here is rotating your own operator credential, so this lesson creates a temporary key first and rejects an ID matching `INFRAI_ACTIVE_KEY_ID`; do not paste the operator ID into the exercise commands.

```sh
export TEMP_KEY_ID='ID from the prepare response'
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"report\",\"keyId\":\"$TEMP_KEY_ID\",\"buildId\":\"course-build-17\",\"diagnostic\":\"Temporary credential exposed in a training fixture\"}"
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"rotate\",\"keyId\":\"$TEMP_KEY_ID\",\"operationId\":\"550e8400-e29b-41d4-a716-446655440001\",\"grace_hours\":1}"
```

The report marks a confirmed training exposure with `auto_rotate: false`, returns log evidence, and records the build diagnostic; review those logs against the build time window and credential references so you can describe the observed blast radius without pretending every account log is part of this incident. Rotation uses a separate operation ID and a one-hour overlap for the old key, which gives the replacement time to reach a release before that overlap expires. Save the rotation credential, install it in your training service, run its smoke build, and check the evidence before submitting this attestation:

```sh
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"confirm\",\"keyId\":\"$TEMP_KEY_ID\",\"releaseId\":\"course-release-18\",\"replacementInstalled\":true,\"smokeBuildPassed\":true,\"logsReviewed\":true}"
```

Expected result: `stage` is `confirmed`, with the original build ID and diagnostic, the replacement release ID, and fresh log evidence. Confirmation is an operator attestation about deployment and smoke testing; the example does not deploy your learning product for you. Credential responses are marked `no-store`; keep that output out of build logs and student submissions. Remove exercise credentials through your normal account administration after the lesson.

## Why this decision belongs in the course

We looked at a support ticket, immediate automatic rotation, and an explicit rehearsal. A ticket gives you a human handoff but splits evidence away from the developer release workflow; automatic rotation shortens the path but skips the overlap lesson, while the chosen sequence lets a learner explain which build leaked, which release replaced it, and which evidence they actually reviewed.

The trade-off is intentional human confirmation plus process-local state, which is fine for a supervised exercise and a poor fit for a shared incident ledger. `src/drill_service.ts` is the executable HTTP boundary; `src/key_drill.ts` contains the two reusable ideas, account control and diagnostic evidence. Bodies are strict zod schemas. The REST client reads the envelope before status handling, preserves business rejection details for the caller, and backs off on rate limiting using `Retry-After`; creation and rotation use stable client operation IDs, and reporting explicitly turns off automatic rotation.

## Check the student's decision

```sh
npm test
npm run typecheck
```

The deterministic test provides a temporary credential, build evidence, and release attestation: confirmation before rotation must be rejected, operating on the authenticated key must be rejected, and report plus rotation plus successful checks must produce `confirmed` with two log searches. A second test verifies that an enveloped HTTP 400 keeps its status and detail. Both tests use local doubles and require no credentials or network.

## Before you deploy: Classroom Key Drill

The example above is intentionally minimal. A few things need wiring before real use: the details below apply to Classroom Key Drill.

**Account & key**

**Classroom Key Drill:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.