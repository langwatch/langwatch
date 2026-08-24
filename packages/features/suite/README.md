# Suite

Suite owns run-plan definitions, reference validation, and their portable
vocabulary. Its canonical server slice provides CRUD, duplication, archiving,
scoped lookup, slug uniqueness, and run preparation through `SuiteService`.

## Boundary

The package owns `SimulationSuite` persistence, definition validation, and the
policy for resolving Scenario, Prompt, and Agent references. It uses their
canonical services and an explicit execution port. The application owns that
port: parameter/secret preparation and event-sourced scheduling.

## Remaining migration seams

- `platform/app/src/server/app-layer/suites/` owns event commands and
  ClickHouse run-state reads; extract that only with the canonical Scenario and
  simulation contracts.
- `platform/app/src/components/suites/`, `components/simulations/`, pages and
  hooks remain application composition because they depend on tRPC stores,
  routing and page layout. Portable UI can move later to `suite/web`.
- The REST `/api/suites` and tRPC suite router consume the process-owned
  `app.suites`; neither transport constructs a service per request.
