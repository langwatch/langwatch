# Suite

Suite owns run-plan definitions, reference validation, run history, and their
portable vocabulary. Its canonical server slice provides CRUD, duplication,
archiving, scoped lookup, slug uniqueness, and run preparation through
`SuiteService`. Its web slice owns the reusable scenario-run card, message
preview, status configuration, and completion treatment.

## Boundary

The package owns `SimulationSuite` persistence, definition validation, and the
policy for resolving Scenario, Prompt, and Agent references. It also owns the
Suite run read boundary: `SuiteService.getSuiteRunState` and
`SuiteService.getBatchHistory` read the event-sourced `suite_runs` fold through
a private ClickHouse repository. The application still supplies the execution
port that dispatches commands and queues work. The same private repository is
also the Eventing fold store, so projection writes and service reads share one
`suite_runs` implementation.

When ClickHouse is unavailable, composition selects an in-memory Eventing store
explicitly; Suite service run reads remain `null`/`[]` rather than pretending a
durable read model exists.

## Remaining migration seams

- The execution port (`server/src/ports/suite-execution.port.ts`) is now
  implemented package-side by `SuiteExecutionService`
  (`server/src/services/suite-execution.service.ts`), which resolves run-only
  parameters and dispatches the existing simulation and Suite-run commands.
  `apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts` only
  injects its collaborators (the command queue, the run-id generator, and run-
  model resolution). The Suite service and its run repository remain
  package-owned.
- `suite/web` owns the controlled scenario/target pickers, run dialogs, and
  run-history presentation, transforms, polling, expansion, and store state.
  As of this writing it is not composed into `apps/ui` — there is no page,
  routing, or drawer host wiring `@langwatch/suite-web` there yet; see
  `dev/docs/plans/suite-restore-review.md` for the tracked restoration work.
- The REST `/api/suites` family (`createSuiteRestApp`, mounted from
  `apps/api/src/app-rest/app-rest.packaged-families.ts`) and the tRPC suite
  router both consume the process-owned `app.suites`; neither transport
  constructs a service per request.
