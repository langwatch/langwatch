# Suite

Suite owns run-plan definitions, reference validation, run history, and their
portable vocabulary. Its canonical server slice provides CRUD, duplication,
archiving, scoped lookup, slug uniqueness, and run preparation through
`SuiteService`. Its web slice owns the reusable scenario-run card, message
preview, status configuration, and completion treatment.

## Boundary

The package owns `SimulationSuite` persistence, definition validation, and the
policy for resolving Scenario, Prompt, and Agent references. It also owns the
event-sourced `suite_runs` fold, stored through a private ClickHouse
repository. The application still supplies the execution port that dispatches
commands and queues work.

When ClickHouse is unavailable, composition selects an in-memory Eventing store
explicitly.

## Remaining migration seams

- Suite execution is `SuiteExecutionService`
  (`process/src/services/suite-execution.service.ts`), which resolves run-only
  parameters and dispatches the existing simulation and Suite-run commands. Its
  collaborators arrive as repositories, channels and peer tokens the container
  builds (ARCHITECTURE.md §5); no file under `apps/` composes it. The Suite
  service and its run repository remain module-owned.
- `@langwatch/suite-browser` routes nothing: its declaration (`suite.web.ts`)
  only declares the `suite:run-history` slice, and `apps/ui` installs it via
  `browser-modules.generated.ts`. Scenario's browser module renders the
  Suite-run pickers, dialogs and run history, reading that slice.
- The REST families (`process/src/transport/test-suites.rest.ts`,
  `suites-alias.rest.ts`, `run-plans.rest.ts`) and the tRPC routers
  (`suite.trpc.ts`, `test-suite.trpc.ts`) are declarations the process mounts
  (ARCHITECTURE.md §8); each handler calls one `*Api` operation, and no
  transport constructs a service per request.
