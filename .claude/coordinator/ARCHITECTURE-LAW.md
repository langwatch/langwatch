# The de-facto architecture, as ruled 2026-09-17

Canonical one-page law. Decisions in LANES.md carry the provenance; this is
the operative summary every lane follows. On conflict, the newest user
ruling wins; tell the coordinator about the conflict.

## Process supply (the kernel)

- `@langwatch/kernel` (`packages/kernel`) owns process composition:
  `createApp({ role }).withModules([...]).with<Member>(...).boot()`.
- Supplies are the closed member vocabulary (process-supply.types.ts);
  storage is declared, not wired: `relational` supplied as postgres in
  production, memory in tests (`withRelational(...)`). No `reads` statics,
  no hand-built infrastructure factories, no absence classes - an absent
  supply is a compile refusal (`MissingSupply<...>`), never a logged
  runtime fallback.
- Module id and supply token are two key spaces: the licensing module owns
  id `licensing`; the supplied source is token `licenseSource`.
- apps/tasks keeps its manual TasksHost until task contributions move into
  module declarations (separate drive).

## Process shape (the target apps/* tree)

- A process is an ENTRYPOINT plus ONE composition file calling `createApp`
  with its modules and supplies. Nothing else: transport hosting (REST,
  tRPC, SSE), static serving, error formatting, lifecycle, signal
  handling and the HTTP listener are the kernel's job, opened by `boot()`
  from what the composition declares - never per-process host files.
- Process config resolves through the package config seam plus each
  module's own declared config schema (createModule interface), inferred
  and validated at boot - no hand-projected config files.
- The same for the WORKER: queue/job hosting, schedulers, eventing wiring
  and liveness are the kernel's, opened by boot() from module
  declarations - a module declares its jobs/subscriptions on the
  createModule interface; the worker's ~40 per-domain composition files
  and its features/ tree (per-app installers, catalogue.json,
  job-registry.json) dissolve into module declarations plus ONE worker
  composition.
- Feature code never lives under apps/* - `discovery` becomes its own
  package (decision 2), apps/worker/src/features/* moves into the owning
  modules, and the tasks/openapi build steps follow their owners.

## Module server shape

- Root index exports the INSTALLER ONLY - transports, config and supplies
  hang on the installer; services/repositories/adapters never leave the
  package.
- Repositories: interface + both backends (postgres/prisma AND memory)
  selected by the registry seam, per the storage law above.
  `withMemoryRepositories(module)` is DELETED, not deprecated (user,
  2026-09-17 late) - a module never wraps itself to pick its backend; the
  process supplies `relational` as postgres or memory. All 35 sites (3
  enterprise production, 32 in tests) port to supplied storage in one
  slice with the function's deletion, the moment the kernel chain is
  adoptable; the banned-legacy-names lint then refuses the spelling.

## Transport law (REST and tRPC)

- Transport files declare routes/procedures ONLY. Every wire schema imports
  from the module's OWN contract - no inline schema or DTO type definitions.
  Sanctioned exception: the `moduleApi<X>()` app-port interface a door
  declares for its own app (the door's contract WITH ITS APP), never
  another module's contract.
- REST routes declare `withInput` and `withOutput`; the framework parses,
  validates, refuses and serialises. Handler receives validated input and
  RETURNS a plain object/array matching the declared output, or THROWS
  (HandledError for named failures, plain Error otherwise).
- No readJsonBody/JSON.parse/safeParse/jsonAnswer/c.json/Response/manual
  status branches on the standard JSON path. Middleware handles parsing.
- `RestErrorHandler` is BANNED outright - always throw; wire-body changes
  on converted error paths are accepted.
- `publicRoute`/`RestRawResult` remain only for genuinely non-JSON
  protocols (SCIM, OAuth device flow, MCP streams, webhook raw bodies) -
  and for EXTERNAL-FACING LEGACY endpoints whose wire shape is documented
  and currently served (the `*-legacy.rest.ts` family: analytics, trace,
  evaluation). Those keep their exact bytes; each carries a one-line
  reason. Internal endpoints get no such grace.

## Web shape

- Nested `features/<sub>/` inside a web package is legal organization;
  what is enforced is ONE closed public entry and ONE install registration
  per web package.
- Cross-module browser sharing goes through `modules/<name>/web-kit`
  leaves; a kit never imports its own module's web package, and a kit
  component never performs project-scoped API queries (presentational
  only; consumers wire data).
- The browser boot target is `@langwatch/ui-kernel` (`createUi`,
  `defineWebModule`) - adoption pending; new work should not deepen the
  hand-rolled `uiFeature`/`WebInstallation` generations.

## Errors

- Throw `HandledError` only when the cause is known AND the caller can
  act; everything else stays a plain Error and degrades to unknown + trace
  id. Codes live in app-codes.ts with presentation-registry copy; tests
  assert on `code`, never message prose.
