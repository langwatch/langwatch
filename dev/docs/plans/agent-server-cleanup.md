# The agent server: from eighteen service files to four services

**Date:** 2026-09-08 · **Owner lane:** one Opus agent · **Reviewer:** Fable (this file is the brief)

## Why

`modules/agent/server/src/services/` holds eighteen files, eighteen classes and
3,912 lines. Five of the classes are a namespace with two or three static functions in it.
Three more hold one real method and a `create`. Three `for (;;)` loops carry the dispatch
and long-poll state machines in their bodies. Seventeen call sites reach through
`runtime.store` to spell Redis keys by hand, and 23 calls use `tryGet` / `tryHgetall`
names the house rule refuses. The protocol underneath is sound (own-project asserts,
once-only delivery, retire-on-gone); the shape around it is not readable.

Alex's words: classes with one function, `while(;;)`, awful structure, so hard to read.

## Target shape

Four services, each a noun a person would name, each owning its state and its Redis keys.
The count is a consequence of the responsibilities, not a target in itself.

```
services/
  agent.service.ts                 what an agent IS: create, read, update, archive, copy,
                                   push to copies, sync from source. One service. The
                                   *ForActor twins collapse into the plain methods with the
                                   actor as an argument; the plain four have no other callers.
  connected-agent-registry.service.ts
                                   which instances EXIST and how they prove who they are:
                                   registration, credential resolution, parameter specs,
                                   instance ownership, last-seen.
  connected-agent-session.service.ts
                                   one instance's LIFE: connect, presence, watch, retire.
                                   Owns every Redis key about a session; nothing else spells
                                   one. Exposes methods, never `runtime` or `now`.
  connected-agent-dispatch.service.ts
                                   a CALL's journey: pick an instance, send, wait for the
                                   reply, long-poll delivery, cancel. The two state machines
                                   live here as named steps, not loop bodies.
  http-agent-test.service.ts       stays: it is the one thing that is not a connected agent.
rules/
  agent-presence.rules.ts          pure functions the namespace classes held
  agent-parameter-spec.rules.ts    (presence, parameter spec, runtime tier): input in, value
  agent-runtime.rules.ts           out, no `this`, no `create`.
```

### The loops

```ts
// today                                          // target
for (;;) {                                        const instance = await this.#pickInstance(...)
  throwIfAborted(signal);                           ?? (await this.#waitForInstance({ until, signal }));
  const instance = await this.#pickInstance(...);
  attempts += 1;                                  // waiting is its own method with its own exit
  ...                                             // condition in its signature (a deadline), and
  if (gaveUp) throw ...;                          // the retry budget is a named constant, not a
}                                                 // counter mutated in a loop body.
```

Every `for (;;)` and `while (true)` goes. A wait is a method whose signature carries the
deadline; a retry is a bounded `for` over a named budget; a poll is `while (remaining > 0)`.
If a loop cannot be written with its exit condition in the header, the body is doing two
things and should be two methods.

### Names and shapes

- No `try*`. `store.tryGet` becomes `store.get` returning `T | null` if redis-client already
  offers it; if it does not, report the missing method rather than keeping the `try` name.
  `apiKeys.tryResolveToken` is Kimi's package; call whatever it exports today and report.
- `{ ok: true }` leaves the contract (`AgentSyncFromSource` returns the synced agent or
  `void`). `_count: { copiedAgents }` leaves the contract; the app answers `copyCount`.
- Ids are ksuid everywhere: `agent_`, `call_`, `pod_`, `tok_` and the registered-agent and
  thread ids. Prefix is the four-letter kind, id is ksuid. `nanoid` and `randomUUID` are gone
  from this package.
- REST responses are built from the contract schema (`schema.parse(entity)` or one
  `toResponse` rules function), never seventeen hand-copied fields.
- `AgentService.update` reads once. `getCopies` is `await`, not `.then`. One
  `findParsedFrame`.
- `src/testing.ts` moves to `app/__tests__/agent.fixture.ts`. Nothing production-side
  imports a test fixture.
- Named-object parameters. A class has at most one `create`. A file has one class.
  Comments at most five lines and 100 columns, and they say why, never what.

## What does not change

- The wire. `modules/agent/specs/*.feature` and every integration test under
  `apps/api/src/features/agent/__tests__` and `modules/agent/server/src/**/__tests__`
  pass unedited except for `@scenario` annotations and imports that follow a moved symbol.
  A test that asserts on the old class names is rewritten to assert on behaviour through the
  new service; a test that only existed to construct a deleted class is deleted with it.
- The connected-agent protocol frames, the long-poll timing constants, the pinning rule for
  sticky agents, once-only delivery and retire-on-gone.
- `agent.server.ts`, the contract package, the web package, the transports. The transport
  declarations call the four services through `AgentApp`; if a transport needs a method that
  moved, follow the move and nothing else.

## Guardrails

- Only `modules/agent/server/**` and `modules/agent/contract/**`. If
  `apps/api` needs an import path change because a symbol moved, list the file and the line
  in the report; do not edit it.
- Never run `git add`, `git commit`, `git stash`, `git checkout` or any git write. Never
  edit a `*-baseline.json`; list lines to delete in the report. Never run root
  `pnpm typecheck`, `pnpm lint` or `pnpm format`. Never read `.env*`.
- Kimi is editing `modules/api-key/**` and its type names right now. Import what
  the api-key contract exports at the moment you build; if a name changes under you,
  re-read and follow it, and say so in the report.
- Lift the logic, do not redesign the protocol. A behaviour that looks wrong goes in the
  report.

## Exit checks

```
pnpm typecheck:one modules/agent/server
pnpm typecheck:one modules/agent/contract
pnpm --filter @langwatch/agent-server test:unit
pnpm --filter @langwatch/agent-contract test:unit
pnpm --filter @langwatch/platform-api test:unit src/features/agent
grep -rnE "for \(;;\)|while \(true\)|\btry[A-Z][A-Za-z]*\(|nanoid|randomUUID|_count|ok: true" modules/agent/server/src modules/agent/contract/src
ls modules/agent/server/src/services
pnpm exec oxlint --config .oxlintrc.jsonc modules/agent/server/src modules/agent/contract/src
```

The grep prints nothing. The `ls` prints five files. oxlint reports no new findings.

## Report format

1. Outcome in two sentences.
2. The five service files with line counts, and the rules files.
3. Each deleted class and where its behaviour now lives (a table).
4. Suite results.
5. Baseline lines to delete; `apps/api` import lines to change.
6. Left open: wire facts you could not preserve, methods redis-client or api-key lack,
   behaviours you think are bugs. Facts, not proposals.
