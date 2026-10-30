# ADR-188: Scenario setup and teardown hooks on HTTP agents

**Date:** 2026-10-22

**Status:** Proposed

## Context

ADR-180 ([180-scenario-run-hooks.md](180-scenario-run-hooks.md)) added setup and teardown hooks to scenario runs, for connected agents only. A connected agent is a process that its owner keeps online. The platform calls the hooks over the connection that process holds open. With no live instance, setup does not run and the run ends `ERROR`.

This has two costs:

- A customer with an HTTP agent cannot use hooks. Many customers have an HTTP endpoint and do not want to run an extra process.
- Langy in prod shows no hooks. The Langy connector (`dev/dogfood/langy/src/agent.ts`) is merged, but it is a process that someone must start and keep online, and nothing does that in prod. The prod scenario sync failed with `Expected one connected agent named "langy", found 0` (https://github.com/langwatch/langwatch/actions/runs/39417655183).

ADR-180 records no reason against HTTP hooks. It only scoped v1 to connected agents.

## Decision

We will add an optional **hooks URL** to the HTTP agent. The platform calls it around the turns of a scenario run, with the same run order, outcomes and recording as ADR-180.

### Calls

- One URL. The body says which hook: `{ "kind": "setup" | "teardown", "run": { scenarioRunId, scenarioName, batchRunId }, "idempotencyKey": "...", "params": {...}, "state"?: {...} }`. `params` is always present. `state` is sent only on teardown, and only if setup returned one. Setup gets no `state`.
- Setup answers `2xx` with a JSON object. That object is the state.
- Teardown answers `2xx`, with an optional JSON object that the run shows. An empty `2xx` body (including `204 No Content`) succeeds with no returned object. Teardown never changes the score.
- A non-`2xx` answer or a non-empty body that is not a JSON object fails the hook. The recorded error is cut to 1,000 characters as a whole (`scenario-run-hooks.rules.ts`). For a bad status it is the status and the start of the body. The platform reads the answer as a stream and stops at 64 KiB. A `2xx` answer over that cap fails the hook with an error that ends "over the 65536-byte cap". A setup `2xx` with an empty body fails, because setup must return an object. A teardown `2xx` with an empty body succeeds. A timeout fails the hook with status `timed_out`, as in ADR-180, and the error `hook timed out after 60 s`.
- The agent form gets two checkboxes, "Call setup" and "Call teardown". A run calls only the hooks that are checked. With no hooks URL, or with both boxes unchecked, the agent runs as today and is marked "No hooks".

### Security

- A hook call sends the agent's configured headers and auth, as a turn does. The URL may use the same `{{ }}` template variables as the turn URL. A customer header named `X-LangWatch-Signature` or `Idempotency-Key`, in any letter case, is not sent, so it cannot stand in for ours.
- The hooks URL must use `https://`. Plain `http://` is allowed only where the deployment's egress policy allows local addresses (`blockLocal` off, for example self-hosted) and the address the egress fence resolved is private or local (`isPrivateOrLocalhostIP`). No redirect is followed. Plain `http://` is refused wherever `blockLocal` (`BLOCK_LOCAL_HTTP_CALLS`) is on, which is how cloud is configured. An allowlisted host may be pinned without a lookup, and then plain `http://` passes (`plainHttpHookRefusal`). The check runs on the URL as typed and again after its template is filled in (`apps/scenario-child/src/rules/http-hook.rules.ts`: `hooksUrlRefusal`, `plainHttpHookRefusal`).
- Stored credentials go only to the origin they were saved for. A hooks URL on a different origin than the saved one (the saved hooks URL, else the turn URL) takes no stored header or auth, and no stored signing secret. The destination check runs once, on the config as typed, in `forUpdate`, before any secret is created. `AgentService.update` also checks blanks, as a second guard. Typing a credential again with its value for the new host saves. Sending back a stored reference to the new origin is refused in any spelling (compared by secret name) with `agent_stored_credentials_destination_mismatch` (`modules/agent/contract/src/agent.errors.ts`). The person rotates the signing secret in the same save.
- Hooks reuse the platform webhook signature. There is one signer, `signWebhookPayload` (today in `modules/webhook/process/src/rules/webhook-signature.rules.ts`; this change moves it to `packages/webhook-signing/src/webhook-signature.ts`, see Consequences), and one header, `WEBHOOK_SIGNATURE_HEADER` (`X-LangWatch-Signature`): `t=<unix seconds>,v1=<hex>[,v1=<hex>]`. The digest is lower-case hex HMAC-SHA256 over `<t>.<raw request body>`. The format is pinned by `specs/webhooks/signature-vectors.json`. Receivers verify with `@langwatch/webhook-verify` (`packages/webhook-verify`), as for webhooks, with a 5-minute tolerance either way. Hooks have no signer or verifier of their own.
- A template that could change the scheme, user or host of the hooks URL is refused at save with `agent_hooks_url_templated_origin`. The URL is read as the URL parser reads it (extra slashes, a backslash, letter case, whitespace). Templates in the path, query and fragment are allowed. A template that is the whole base, such as `{{ params.base }}/hooks`, is refused too. The check is `templatesHooksOrigin` in `modules/agent/contract/src/hooks-url.ts` (new code).
- Defence in depth: before a hook is sent, the origin of the rendered hooks URL must equal the fixed origin of the saved hooks URL (`readHooksOrigin`, same file; `hookOriginRefusal` in `apps/scenario-child/src/rules/http-hook.rules.ts`, new code). If it does not, or the saved URL has no fixed origin (for example it was saved before this rule), the hook fails and no request is sent.
- A pushed or synced copy of an agent whose source hooks URL is on another origin than the copy's gets no stored credentials, no signing secret and no rotation window (`configForCopy` in `agent-secrets.rules.ts`).
- Each agent has a signing secret, stored as a secret. The agent form makes it when a hooks URL is first typed and shows it once, so the person copies it before saving. A signing secret is at least 16 characters. If the secret is missing when a hook runs, the hook fails with "The hooks signing secret is missing" and nothing is sent. A hook is never sent unsigned.
- Rotation keeps an overlap window, as webhook endpoints do. A rotation to the same origin keeps the old secret valid for `WEBHOOK_PREVIOUS_SECRET_TTL_MS` (24 h). The server stores it as the server-only config field `hooksPreviousSigningSecret { secret: "{{ secrets.NAME }}", expiresAt }` (`modules/agent/contract/src/config/http.ts`); a value sent by a client is ignored. While the window is open a call is signed with both secrets, one `v1` each, newest first (`hookSigningSecretReferences` in `http-hook.rules.ts`). A second rotation inside the window drops the oldest secret at once. A move to another hooks origin keeps no previous secret. Removing the hooks URL deletes the current and the previous secret. An expired previous secret never signs, and the first save after expiry deletes it (no sweep job yet). A secret is deleted only if it is stored under the platform's name for this agent's signing-secret field (`isStoredSecretNameFor`, `modules/agent/contract/src/http-node.ts`) and no other agent names it. A secret the person picked is kept (`modules/agent/process/src/rules/agent-secrets.rules.ts`: `withPreviousSigningSecret`, `replacedSigningSecretNames`).
- Every call carries `Idempotency-Key: <scenarioRunId>:<attemptId>:<kind>`, and the same value in the signed body as `idempotencyKey`. Receivers should read the key from the signed body, because the signature does not cover headers. The `attemptId` comes from `generate("hookattempt")`, made once for each execution of the run in the child process by the HTTP agent channel (`apps/scenario-child/src/channels/http/http.serialized-http-agent.channel.ts`). Setup and teardown of one attempt share it. The job queue delivers at least once, so a run can execute again under the same run id after teardown deleted its data. That execution gets a new key on purpose, so the receiver makes the data again. A receiver can use the key to make test data once per attempt. The platform does not retry a hook over HTTP in v1. Only a scenario run calls hooks (`modules/scenario/specs/scenario-run-hooks.feature`, Rule "Where hooks run"), so every scenario run sets `scenarioRunId`. If it is absent, the key is `<attemptId>:<kind>` (`http-hook.rules.ts`, `hookIdempotencyKey`; spec `scenario-run-hooks.feature`).
- Apart from the `https://` rule above, the hooks URL goes through the same egress fence as the turn URL (`createSsrfUrlValidator` and `fetchValidatedDestination` from `@langwatch/egress`, in `apps/scenario-child/src/channels/http/http.worker-egress.channel.ts`). The response read is capped at 64 KiB.

### State in turns

- The turn body, header and URL templates gain `{{ state }}` (the whole state as JSON) and `{{ state.NAME }}`. They are bound only when the job carries a hooks URL: a non-empty hooks URL and at least one hook checked (`httpHookFields` in `scenario-target-prefetch.service.ts`). Before setup answers, or when setup returned nothing, `{{ state }}` renders `{}`. So a turn can send what setup made, for example a test customer id.
- The simulated user and the judge see the state on every turn, as in ADR-180.
- An HTTP agent's turn cannot update the state. Only setup sets it.

### Reused from ADR-180

A fixed 60 s timeout per hook (no per-scenario override yet), the 64 KiB cap on state and on teardown's returned object, the 1,000-character error cut, "Not scored" when setup fails, teardown attempted in a `finally`, the Setup and Teardown bands on the run, and the hook event and record. Retries: none in v1, as in ADR-180.

### Langy in prod (future work)

This part is not built by the first PRs (see Future work under Consequences).

- Prod Langy runs as an HTTP agent. Its turns call Langy's public REST API (`POST /api/langy/conversations/:id/messages`), as the connector does today.
- The setup and teardown code in `dev/dogfood/langy` moves behind one hooks URL in a small stateless service. It only calls the LangWatch public API, so it needs no database of its own.
- CI deploys that service on every merge to main that touches `dev/dogfood/langy`, so merged means live.
- Then the scenario sync (`.github/workflows/langy-scenarios-sync.yml`) runs for real, not as a dry run, and finds the agent by name.

## Rationale / Trade-offs

A hooks URL keeps one hook model for both agent kinds: only the delivery differs (a relay call for a connected agent, an HTTP POST for an HTTP agent). The run side from ADR-180 is reused as it is.

One URL with `kind`, not two URLs, means one route and one auth setup for the customer. The cost is a field that the receiver must switch on.

The signature costs the customer a few lines to check, but a hook creates and deletes data, so the receiver must know the call is from LangWatch. Headers alone do not prove this when the customer reuses a turn API key that other clients also hold.

Not letting an HTTP turn update the state keeps the HTTP turn contract as it is. A connected agent can still do it.

For Langy, the hook service is still something to host. But a CI deploy keeps it in step with main, which the connector on a dev machine cannot do.

## Consequences

- The HTTP agent model gains `hooksUrl`, `hooks: { setup, teardown }` and a signing secret (stored as a secret, like the agent's other secrets).
- `signWebhookPayload`, `WEBHOOK_SIGNATURE_HEADER` and their tests move from `modules/webhook/process/src/rules/webhook-signature.rules.ts` to a new package, `packages/webhook-signing` (`@langwatch/webhook-signing`), with no change to the code. The scenario child cannot import another module's process package, and a contract or module library may not use `node:crypto`, so a shared package is the one place both can use. The webhook module's callers import it from there, and `specs/webhooks/signature-vectors.json` points `generated_from` at the new path.
- `apps/scenario-child` gains an HTTP hook caller next to `http.serialized-http-agent.channel.ts`, and the template context gains `state`. Connected and HTTP calls share one run shape, `ScenarioCallRun` (`apps/scenario-child/src/rules/scenario-call-run.rules.ts`).
- `modules/scenario/specs/scenario-run-hooks.feature` changes. Its scenario "An HTTP agent without a hooks URL and a code agent never call hooks" still holds. A new scenario group covers an HTTP agent with a hooks URL: calls, signing, rotation, the URL rule and the origin move.
- The run-result UI does not change.
- The docs gain an HTTP section on the hooks page, with a signature-check example (https://github.com/langwatch/langwatch/issues/8800).

### Future work

The first PRs (https://github.com/langwatch/langwatch/pull/9193, https://github.com/langwatch/langwatch/pull/9194, https://github.com/langwatch/langwatch/pull/9195) do not build the "Langy in prod" part. It comes later:

- The Langy hook service.
- Its CI deploy.
- The prod Langy agent switch from connected to HTTP.

## Open

- Where the Langy hook service is hosted (owner's call).

## References

- Related ADRs: ADR-128 ([128-connected-agents.md](128-connected-agents.md)), ADR-180 ([180-scenario-run-hooks.md](180-scenario-run-hooks.md)).
- Issue: https://github.com/langwatch/langwatch/issues/8955
- Hooks PR: https://github.com/langwatch/langwatch/pull/8765
- Spec: `modules/scenario/specs/scenario-run-hooks.feature`.
- Signing: `packages/webhook-signing/src/webhook-signature.ts`, `specs/webhooks/signature-vectors.json`, `packages/webhook-verify`.
- Implementation PR: https://github.com/langwatch/langwatch/pull/9193
