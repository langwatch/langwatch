# LangWatchQL and Dashboards telemetry

> **Why this exists**: the LangWatchQL Grafana board
> (`docs/langwatchql-queries-dashboard.json`) and the Dashboards product events
> answer narrow questions. This page says what they count, what they leave out,
> and what they cost, so nobody reads more into a number than it holds.
> Requirements: `modules/dashboard/specs/dashboards-telemetry.feature`.

## What is counted

| Signal                        | Kind      | Labels or attributes                        | Written by                            |
| ----------------------------- | --------- | ------------------------------------------- | ------------------------------------- |
| `lwql_queries_total`          | counter   | `caller`, `outcome`                         | `LangWatchQLRunTelemetryService`      |
| `lwql_query_duration_seconds` | histogram | `caller`                                    | same                                  |
| `lwql_rows_read`              | histogram | `caller`                                    | same                                  |
| one log line per run          | log       | `caller`, `queryHash`, board and widget ids | same                                  |
| `dashboards.<action>.<name>`  | PostHog   | attributes we set: no raw ids, SQL or text  | `dashboard-usage-events.ts` (browser) |

`caller` is one of `dashboard_widget`, `workbench`, `rest_api`, `saved_chart`,
`source_presence`, or `unnamed` when a run names none.

`outcome` is `ok`, `empty` (no rows), `aborted`, `unhandled`, or the code of the
handled error that stopped the run. Handled codes are a fixed set in the code,
so the label stays bounded.

## Ids that still reach PostHog

The attributes Dashboards sets carry no raw board or widget id, no SQL and no
question text. Two ids still reach PostHog:

- the browser host adds the page URL (`context.href`) to every event, and a
  board's URL holds its id;
- `projectId` is registered on every event, so events group per project.

Removing them would change every module's events, not only Dashboards'.

## Aborted runs

A run its caller hung up on (a widget unmounted, a request cancelled) is
`aborted`. It is not an error: the error-rate panel and any alert on it exclude
it. The outcome panel shows aborts as their own line.

## What is not counted

- **Refusals before the app**: a disabled Workbench, `resolveRunCaller` and the
  tRPC permission check refuse before the instrumented layer runs. The error
  rate is the share of runs that reached it, not of every attempt.
- **Instant-eval passes**: `executePass` does not record telemetry.
- **Langy's own API calls**: Langy calling LangWatchQL over MCP or REST counts
  as `rest_api`. REST, CLI and MCP also share `rest_api`. A request marker that
  splits them is planned with the Langy attribution follow-up.
- **The Langy composer**: `dashboards.asked.langy` counts the board ask bar and
  "Add a widget", not questions typed in Langy's own composer. Widgets Langy
  makes on the server send no browser event.

## The query hash is not a privacy control

`queryHash` is the first 16 hex characters of an unsalted SHA-256 of the
statement with its whitespace collapsed. It only groups the same slow query in
the logs. Anyone with the log line can confirm a guessed statement, literals
included, so treat the hash like the query text: internal logs only, never in
a product event or a customer-facing surface.

## Cardinality

Per process, before any aggregation:

| Metric                        | Series                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| `lwql_queries_total`          | 6 callers x outcomes seen (4 fixed plus the handled codes) |
| `lwql_query_duration_seconds` | 6 callers x 14 (12 buckets, sum, count) = 84               |
| `lwql_rows_read`              | 6 callers x 11 (9 buckets, sum, count) = 66                |

No label holds an id, a hash or user input. Board, widget and hash values live
only in the log line, which Prometheus never reads.

## Retention, sampling and cost

- **Sampling**: none. Every run is counted and logged; every product event is
  sent.
- **Metrics**: kept as long as the Prometheus that scrapes the api keeps
  series. This change sets no retention of its own.
- **Logs**: one line per run. Retention is the log group's setting; the slow
  query panel needs the production CloudWatch log group to be configured.
- **PostHog**: one event per board view and one per user action listed in the
  spec, never per query run. Retention follows the PostHog plan.
- **Cost**: the metrics add the fixed series above. Log and PostHog volume
  grow with runs and with board views; measure both after the first production
  week before adding sampling.

## Not done yet

The production alert rule, the production CloudWatch log group and a check of
the production numbers after deploy are tracked in
https://github.com/langwatch/tasks/issues/1040 and need their own change to
production monitoring.
