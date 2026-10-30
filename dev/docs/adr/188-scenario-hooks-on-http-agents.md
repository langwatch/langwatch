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
- A non-`2xx` answer or a non-empty body that is not a JSON object fails the hook. The error is the status and the first 1,000 characters of the body. The platform reads the answer as a stream and stops at 64 KiB. A `2xx` answer over that cap fails the hook with an error that ends "over the 65536-byte cap". A setup `2xx` with an empty body fails, because setup must return an object. A teardown `2xx` with an empty body succeeds. A timeout fails the hook with status `timed_out`, as in ADR-180, and the error `hook timed out after 60 s`.
- The agent form gets two checkboxes, "Call setup" and "Call teardown". A run calls only the hooks that are checked. With no hooks URL, or with both boxes unchecked, the agent runs as today and is marked "No hooks".

### Security

- A hook call sends the agent's configured headers and auth, as a turn does. The URL may use the same `{{ }}` template variables as the turn URL. A customer header named `X-LangWatch-Signature` or `Idempotency-Key`, in any letter case, is not sent, so it cannot stand in for ours.
- The hooks URL must use `https://`. Plain `http://` is allowed only for loopback hosts (`localhost`, `127.*`, `[::1]`).
- Stored credentials go only to the origin they were saved for. A hooks URL on a different origin than the saved one (the saved hooks URL, else the turn URL) takes no stored header or auth, and no stored signing secret. A save that sends them back blank, or sends back a `{{ secrets.NAME }}` reference to the new origin, is refused. The person types the headers and auth again and rotates the signing secret in the same save.
- Every call carries `X-LangWatch-Signature: t=<unix seconds>,v1=<signature>`, with a signing secret per agent. The signature is the lower-case hex HMAC-SHA256, keyed with the secret, over the UTF-8 bytes of `<t>.<raw request body>`: the decimal `t`, a `.`, then the body exactly as sent. The agent form makes the secret when a hooks URL is first typed and shows it once, so the person copies it before saving. It can be rotated. A rotation, or removing the hooks URL, deletes the old secret after the save lands, with no overlap window. It deletes the old secret only if that save made it and no other agent in the project names it. If the secret is missing when a hook runs, the hook fails with "The hooks signing secret is missing" and nothing is sent. A hook is never sent unsigned. The receiver should compare signatures in constant time and reject a call whose `t` is more than 5 minutes away from its own clock, in either direction.
- Every call carries `Idempotency-Key: <scenarioRunId>:<attemptId>:<kind>`, and the same value in the signed body as `idempotencyKey`. Without a run id the key is `<attemptId>:<kind>`. Receivers should read the key from the signed body, because the signature does not cover headers. The `attemptId` is new for each execution of the run in the child process, and setup and teardown of one attempt share it. The job queue delivers at least once, so a run can execute again under the same run id after teardown deleted its data. That execution gets a new key on purpose, so the receiver makes the data again. A receiver can use the key to make test data once per attempt. The platform does not retry a hook over HTTP in v1.
- Apart from the `https://` rule above, the hooks URL goes through the same outbound URL checks as the turn URL.

### State in turns

- The turn body, header and URL templates gain `{{ state }}` (the whole state as JSON) and `{{ state.NAME }}`. They are bound only for an agent with a hooks URL. Before setup answers, or when setup returned nothing, `{{ state }}` renders `{}`. So a turn can send what setup made, for example a test customer id.
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
- `apps/scenario-child` gains an HTTP hook caller next to `http.serialized-http-agent.channel.ts`, and the template context gains `state`.
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
