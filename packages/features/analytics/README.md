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
