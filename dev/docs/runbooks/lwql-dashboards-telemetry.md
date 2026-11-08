# LangWatchQL and Dashboards telemetry

What we record about Dashboards, LangWatchQL and Langy: where each signal
goes, how it gets there, and why we want it. Requirements:
`modules/dashboard/specs/dashboards-telemetry.feature`.

## Where things go, and why there

| Place                                 | What goes there                                    | Why there                                                                                                      |
| ------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **PostHog**                           | things a person did on purpose                     | to see whether people use boards and Langy. PostHog bills per event, so it never gets one event per query run. |
| **Prometheus, shown in Grafana**      | a count, a duration and a row count for every run  | to see volume, speed and errors. A fixed set of series costs the same at any volume.                           |
| **Our own logs (CloudWatch in prod)** | one line per run, with who ran it and how it ended | to find one slow or failing run. Not billed per line; never sent to PostHog.                                   |

A board left open on Live re-runs every widget every minute with nobody
watching. Those runs reach Grafana and the logs only, never PostHog.

## Every signal

### Query runs (server, every run)

| Signal                                     | Where   | How                                                                                                | Why                                          |
| ------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `lwql_queries_total{caller,outcome}`       | Grafana | `LangWatchQLRunTelemetryService`, after each run ends                                              | how many runs, from where, and how many fail |
| `lwql_query_duration_seconds{caller}`      | Grafana | same                                                                                               | which callers are slow                       |
| `lwql_rows_read{caller}`                   | Grafana | same                                                                                               | which callers read the most data             |
| "LangWatchQL executed" / "failed" log line | logs    | same; carries `caller`, `outcome`, `queryHash`, board, widget and template ids, and the error code | find the run behind a slow or failing number |

The Grafana board is `docs/langwatchql-queries-dashboard.json`.

### What people do (PostHog)

Sent from the browser through `useUiAnalytics`, after the server accepts the
change. Each event also carries `projectId`.

| Event                                                | Sent when                                                                        | Why                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `dashboards.viewed.dashboard`                        | a board opens (`dashboardKind`, `widgetCount`, `dashboardKey`)                   | are boards opened, and which kinds             |
| `dashboards.created.dashboard` / `deleted.dashboard` | the server accepts it (on create: `createdFrom`, `templateId` when from one)     | do people make their own boards, and keep them |
| `dashboards.added.widget`                            | the server accepts it (`addedFrom`, `addedCount`)                                | do people build widgets, and from what         |
| `dashboards.edited.widget` / `deleted.widget`        | the server accepts it                                                            | do people keep their widgets up to date        |
| `dashboards.viewed.widget`                           | half a card first shows on screen, once per card per board view (`widgetSource`) | which widgets are looked at, not only loaded   |
| `dashboards.changed.period`                          | the period changes (`range`, `grain`)                                            | which periods people need                      |
| `dashboards.exported.widget`                         | a CSV download finishes (`format`)                                               | do people take data out                        |
| `dashboards.edited.dashboard`                        | a rename is saved or a drop changes the layout (`change`)                        | do people shape their boards                   |
| `dashboards.favourited.dashboard`                    | a pin is added or removed (`starred`)                                            | which boards people come back to               |
| `dashboards.toggled.langy_traces`                    | a saved widget starts or stops counting Langy's traces (`included`)              | do people want Langy's own traces counted      |
| `lwql.opened.editor`                                 | the widget editor opens (`widgetIs: new or existing`)                            | do people write queries                        |
| `lwql.ran.query`                                     | a member presses Run in the editor                                               | do they get as far as running one              |
| `langy.asked.question`                               | a member sends Langy a question (`surface`: `composer`, `ask_bar`, `add_widget`) | where people ask Langy for help                |
| `langy.applied.proposal` / `discarded.proposal`      | a member applies or discards what Langy proposed (`kind`, or `other`)            | does Langy's help get used                     |
| `insights.filed/seen/archived/kept.insight`          | sent by nurturing from insight's own events, on the person who acted             | are insights read and acted on                 |
| `automations.opened.alert_link`                      | a signed-in member opens a link marked `lw_from=alert` (`landedOn`)              | do alerts bring people back to the app         |

No attribute we set carries a raw board or widget id, SQL, a title or question
text. `dashboardKey` is 16 hex of SHA-256 of the board id.

## How a run gets its caller

The server sets `caller` from the door the run came in by; the browser cannot
choose it.

- Board widget or Workbench (tRPC): `dashboard_widget` or `workbench`. A From
  LangWatch board's widgets count as `dashboard_widget`.
- Saved chart and source check: `saved_chart` and `source_presence`.
- `/api/v1/query`: `langy` for Langy's session key; `cli` and `mcp` from the
  headers the CLI and MCP servers already send; anything else is `rest_api`. A
  copied header only moves a run between `cli`, `mcp` and `rest_api`, so the
  split is for usage, not security.
- `unnamed` when a run names none.

`outcome` is `ok`, `empty` (no rows), `aborted` (the caller hung up, not an
error; excluded from the error rate), `unhandled`, or a handled error code from
a fixed set.

## Alert links

The digest email and the default Slack message mark links into our own app
with `lw_from=alert`. Webhook bodies, custom templates and other sites' links
are sent unchanged. On landing, the app sends `automations.opened.alert_link`
once and removes the marker from the address, so Back, a reload or a copied
link does not send it again.

## What is not recorded, and why

- **The SQL text.** Logs carry `queryHash`: the first 16 hex of an HMAC-SHA256
  of the statement, keyed from the deployment secret (`API_KEY_PEPPER`, else
  `CREDENTIALS_SECRET`, else `NEXTAUTH_SECRET`; the app will not boot without
  one). It groups the same query without revealing it. Replacing it with the
  capped text plus the user id, in our logs only, is waiting on Drew's "go".
- **Runs refused before the app** (a disabled Workbench, the tRPC permission
  check): they never reach the counted layer, so the error rate is a share of
  runs that did.
- **Instant-eval passes**: `executePass` records nothing.
- **Which boards and widgets Langy made**: no "made by" field is stored yet.
- **A question the app passes on**: a question from the ask bar or "Add a
  widget" counts once, where it was asked, not again when the panel sends it.
- **Alert triggers created, changed, fired or delivered**: triggers have no
  change events to count from. Needs its own plan.
- **Report schedules**: their events name no person to count them on. Needs a
  decision.
- **Insight renewals**: a renewal names no person.

## Things to know when reading the numbers

- PostHog events still carry two ids: the page URL the browser host adds to
  every event (a board's URL holds its id) and `projectId`. Removing them would
  change every module's events.
- `dashboards.viewed.widget` also counts a card that is half visible only while
  the board lays out. If it looks high, require 500 ms on screen.
- No sampling. Metrics add a fixed set of series per process (about 6 callers
  times their outcomes and buckets). Log and PostHog volume grow with runs and
  board views; measure after the first production week.

## Not done yet

The production alert rule, the CloudWatch log group and a check of the
production numbers after deploy: https://github.com/langwatch/tasks/issues/1040.
