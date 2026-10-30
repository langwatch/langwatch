# ADR-188: Scenario setup and teardown hooks on HTTP agents

**Date:** 2026-10-22

**Status:** Proposed

## Context

ADR-180 ([180-scenario-run-hooks.md](180-scenario-run-hooks.md)) added setup and teardown hooks to scenario runs, for connected agents only. A connected agent is a process that its owner keeps online. The platform calls the hooks over the connection that process holds open. With no live instance, setup does not run and the run ends `ERROR`.

This has two costs:

- A customer with an HTTP agent cannot use hooks. Many customers have an HTTP endpoint and do not want to run an extra process.
- Langy in prod shows no hooks. The Langy connector (`dev/dogfood/langy/src/agent.ts`) is merged, but a deploy does not start it, and nothing else does. The prod scenario sync failed with `Expected one connected agent named "langy", found 0` (https://github.com/langwatch/langwatch/actions/runs/39417655183).

ADR-180 records no reason against HTTP hooks. It only scoped v1 to connected agents.

## Decision

We will add an optional **hooks URL** to the HTTP agent. The platform calls it around the turns of a scenario run, with the same run order, outcomes and recording as ADR-180.

### Calls

- One URL. The body says which hook: `{ "kind": "setup" | "teardown", "run": { scenarioRunId, scenarioName, batchRunId }, "params": {...}, "state"?: {...} }`. Setup gets no `state`. Teardown gets the state setup returned.
- Setup answers `2xx` with a JSON object. That object is the state.
- Teardown answers `2xx`, with an optional JSON object that the run shows. An empty `2xx` body (including `204 No Content`) succeeds with no returned object. Teardown never changes the score.
- A non-`2xx` answer or a non-empty body that is not a JSON object fails the hook. The error is the status and the first 1,000 characters of the body. A timeout fails the hook with status `timed_out`, as in ADR-180, and the error `hook timed out after 60 s`.
- The agent form gets two checkboxes, "Call setup" and "Call teardown". A run calls only the hooks that are checked. With no hooks URL, or with both boxes unchecked, the agent runs as today and is marked "No hooks".

### Security

- A hook call sends the agent's configured headers and auth, as a turn does. The URL may use the same `{{ }}` template variables as the turn URL.
- Every call carries `X-LangWatch-Signature: t=<unix seconds>,v1=<signature>`, with a signing secret per agent. The signature is the lower-case hex HMAC-SHA256, keyed with the secret, over the UTF-8 bytes of `<t>.<raw request body>`: the decimal `t`, a `.`, then the body exactly as sent. The agent form makes the secret when a hooks URL is first typed and shows it once, until the agent is saved or the form is closed. It can be rotated. The receiver should compare signatures in constant time and reject a call whose `t` is more than 5 minutes away from its own clock, in either direction.
- Every call carries `Idempotency-Key: <scenarioRunId>:<kind>`. A retry of the same hook sends the same key, so a receiver can make test data once.
- The hooks URL goes through the same outbound URL checks as the turn URL.

### State in turns

- The turn body and URL templates gain `{{ state }}` (the whole state as JSON) and `{{ state.NAME }}`. So a turn can send what setup made, for example a test customer id.
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
- Discussion: Convoz conv 114.
