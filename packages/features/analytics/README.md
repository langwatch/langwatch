# Analytics

Analytics owns the server-side timeseries, feedback, and top-document read
capabilities. The contract is portable Zod 4 vocabulary; the server contains
one service, ClickHouse query builders, and one private repository
implementation. The application supplies only concrete ClickHouse client
resolution and transport composition.

Analytics does not own dashboards, saved charts, topics, traces, evaluations,
or API routes. Those features consume the Analytics service contract. The
service always passes the project id as the ClickHouse tenant and falls back to
the legacy source table whenever a rollup or slim query cannot express the
request safely.

The Analytics web surface owns the controlled LangWatchQL workbench, editor,
parameters and time-window controls, schema and result views, portable request
state, and Vega-Lite policy/specification behaviour. The application retains
routing, tRPC query/schema transport, saved-chart persistence, and the narrow
error, colour-mode, and lazy-chart render ports. This web extraction does not
change the timeseries service or the separate trace analytics, trace summaries,
or timeseries rollup boundaries.

Server-side LangWatchQL execution lives under
`packages/features/analytics/server/src/langwatch-ql/`; `apps/api` composes and
mounts it (`analytics.lwql` on the tRPC router) but does not own its behaviour.

The LangWatchQL behaviour contract is [the web spec](./specs/analytics-lwql-workbench.feature);
the chart-runtime decision is [ADR-002](./adrs/002-lwql-chart-runtime-without-eval.md),
and portable workbench conventions are in [the web guide](./docs/lwql-workbench.md).
