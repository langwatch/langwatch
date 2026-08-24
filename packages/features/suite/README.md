# Suite

Suite owns run-plan definitions and their portable vocabulary. Its current
canonical server slice provides CRUD, duplication, archiving, scoped lookup and
slug uniqueness through `SuiteService`.

## Boundary

The package owns `SimulationSuite` persistence and definition validation. It
does not own Scenario definitions, Prompt or Agent references, simulation read
models, or event-sourced execution. The application composes those features at
the run boundary.

## Remaining migration seams

- `platform/app/src/server/suites/suite.service.ts` still orchestrates a run
  using the legacy Scenario repository and `app.suiteRuns` pipeline.
- `platform/app/src/server/app-layer/suites/` owns event commands and
  ClickHouse run-state reads; extract that only with the canonical Scenario and
  simulation contracts.
- `platform/app/src/components/suites/`, `components/simulations/`, pages and
  hooks remain application composition because they depend on tRPC stores,
  routing and page layout. Portable UI can move later to `suite/web`.
- The REST `/api/suites` and tRPC suite router must consume `app.suites` once
  App composition registers `PostgresSuiteAdapter`; neither transport should
  construct a service per request.
