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

- The execution port (`server/src/ports/suite-execution.port.ts`) is now
  implemented package-side by `SuiteExecutionService`
  (`server/src/services/suite-execution.service.ts`), which resolves run-only
  parameters and dispatches the existing simulation and Suite-run commands.
  `apps/api/src/features/scenario/scenario.composition.ts` only
  injects its collaborators (the command queue, the run-id generator, and run-
  model resolution). The Suite service and its run repository remain
  package-owned.
- `@langwatch/suite-browser` routes nothing: its declaration (`suite.web.ts`)
  only declares the `suite:run-history` slice, and `apps/ui` installs it via
  `browser-modules.generated.ts`. Scenario's browser module renders the
  Suite-run pickers, dialogs and run history, reading that slice.
- The REST `/api/suites` family (`createSuiteRestApp`, mounted from
  `apps/api/src/app-rest/app-rest.packaged-families.ts`) and the tRPC suite
  router both consume the process-owned `app.suites`; neither transport
  constructs a service per request.
