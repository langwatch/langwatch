# ADR-001: dev-runtime runs the Node applications in one local process, for contributors only

**Status:** Accepted

**Behavioural contract:** [Dev runtime](../specs/dev-runtime.feature)

**Related:** [ADR-168](../../../dev/docs/adr/168-one-process-dev-with-debounced-module-reload.md),
`dev/docs/ARCHITECTURE.md` sections 1 and 4, `dev/docs/LOCAL_STACK.md`.

## Context

Contributors run the api, worker and ui together. Starting three Node processes costs memory and
start-up time, and a stack missing the worker silently processes no jobs.

## Decision

`tools/dev-runtime` composes the existing application entry points (api and worker) inside one Node process. It is contributor-only: nothing ships it, no
production image includes it, and no application imports it.

It holds no product code and no module logic. It calls the same `main.ts` composition each app
exposes, and reloads the backend in process behind a debounce. The reload mechanics are decided in
ADR-168; this record fixes only the boundary.

## Public surfaces and transports

None. The boot and drain seam it hosts (`startBackend`, `drainBackend`) is framework, in
`@langwatch/process/backend-host`, which `apps/backend` also runs; `src/backend.process.ts` adds only the
reload generation the dev entry uses. It serves no route and declares no transport.

## Dependencies

The application composition (`@langwatch/platform-api`, `@langwatch/worker`), `@langwatch/process`, `@langwatch/observability`,
`@langwatch/time` and `vite`. No feature module is imported directly.

## Persistence

None. It owns no table, store or file.

## Runtime and registration

A local Node process started by `pnpm dev` or `pnpm dev:hmr`. It is not registered in any deployment.

## Environment and configuration

It reads the same environment the applications read, resolved through their own configuration. It
adds only the debounce settings ADR-168 names (the agent-turn hold was retired 2026-10-09).

## Errors

A boot failure of any hosted application ends the process with that application's error; the runtime
adds no error codes.

## Contracts and validation

None. It exposes no contract and validates no input.

## Consequences

- An app never carries a dev-only branch; the difference lives here.
- Removing the package changes no deployed behaviour.
