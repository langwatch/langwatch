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

- `platform/app/src/runtime/app/features/suite-execution.adapter.ts` is the application
  execution port: it resolves run-only parameters and dispatches the existing
  simulation and Suite-run commands. The Suite service and its run repository
  remain package-owned.
- `platform/app/src/components/suites/` retains only page and transport
  composition: form orchestration, routing, tRPC queries, and drawers. The
  controlled scenario/target pickers, run dialogs, and run-history
  presentation, transforms, polling, expansion, and store state live in
  `suite/web` and are driven by explicit callbacks from the app.
- The REST `/api/suites` and tRPC suite router consume the process-owned
  `app.suites`; neither transport constructs a service per request.
