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

## Module server shape

- Root index exports the INSTALLER ONLY - transports, config and supplies
  hang on the installer; services/repositories/adapters never leave the
  package.
- Repositories: interface + both backends (postgres/prisma AND memory)
  selected by the registry seam, per the storage law above.

## Transport law (REST and tRPC)

- Transport files declare routes/procedures ONLY. No schema or type
  definitions - every schema imports from the module's OWN contract, never
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
