# LangWatchQL and Dashboards telemetry

> **Why this exists**: the LangWatchQL Grafana board
> (`docs/langwatchql-queries-dashboard.json`) and the Dashboards product events
> answer narrow questions. This page says what they count, what they leave out,
> and what they cost, so nobody reads more into a number than it holds.
> Requirements: `modules/dashboard/specs/dashboards-telemetry.feature`.

## What is counted

| Signal                          | Kind      | Labels or attributes                           | Written by                            |
| ------------------------------- | --------- | ---------------------------------------------- | ------------------------------------- |
| `lwql_queries_total`            | counter   | `caller`, `outcome`                            | `LangWatchQLRunTelemetryService`      |
| `lwql_query_duration_seconds`   | histogram | `caller`                                       | same                                  |
| `lwql_rows_read`                | histogram | `caller`                                       | same                                  |
| one log line per run            | log       | `caller`, `queryHash`, board and widget ids    | same                                  |
| `dashboards.<action>.<name>`    | PostHog   | attributes we set: no raw ids, SQL or text     | `dashboard-usage-events.ts` (browser) |
| `langy.asked.question`          | PostHog   | `surface`: `composer`, `ask_bar`, `add_widget` | `langy-ask.ts` (browser)              |
| `langy.applied.proposal`        | PostHog   | `kind` (or `other`)                            | `langy-ask.ts` (browser)              |
| `langy.discarded.proposal`      | PostHog   | `kind` (or `other`)                            | `langy-ask.ts` (browser)              |
| `insights.<act>.insight`        | PostHog   | a filing: `filedVia`, `tone`, `fromBoard`      | nurturing, from insight's events      |
| `automations.opened.alert_link` | PostHog   | `landedOn`: `trace`, `graph` or `other`        | `use-alert-link-opened.ts` (shell)    |

`caller` is one of `dashboard_widget`, `workbench`, `rest_api`, `cli`, `mcp`,
`langy`, `saved_chart`, `source_presence`, or `unnamed` when a run names none.

A query sent with an API key is split by the client that sent it. The server
reads the identity headers the LangWatch CLI and the MCP servers already send:
the CLI is `cli`, a local or hosted MCP server is `mcp`, and every other client
(an SDK, a script, curl) is `rest_api`. A query sent with the session key Langy
gets for a chat is `langy`, whichever client it came from.

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

## A widget seen

`dashboards.viewed.widget` is sent the first time half of a widget's card is on
screen, once per card per board view. A card that is half visible only while
the board is still laying out (before a banner pushes it down) also counts.
On boards that load slowly this can raise the count. If the numbers look
high, require the card to stay on screen for about 500 ms before sending.

## Aborted runs

A run its caller hung up on (a widget unmounted, a request cancelled) is
`aborted`. It is not an error: the error-rate panel and any alert on it exclude
it. The outcome panel shows aborts as their own line.

## What is not counted

- **Refusals before the app**: a disabled Workbench, `resolveRunCaller` and the
  tRPC permission check refuse before the instrumented layer runs. The error
  rate is the share of runs that reached it, not of every attempt.
- **Instant-eval passes**: `executePass` does not record telemetry.
- **Clients that do not say who they are**: a script that copies the CLI's or
  the MCP server's headers is counted as that client. The split is for usage,
  not for security.
- **Langy's widgets as widgets**: a widget Langy adds still runs its queries as
  `dashboard_widget`. Boards and widgets Langy makes send no product event yet:
  there is no "made by" field on a widget and no Dashboards event pipeline for
  nurturing to read.
- **Questions the app sends for a member**: a question from the ask bar or "Add
  a widget" is counted once, where it was asked. When the Langy panel then
  sends it, or sends a card's follow-up, it counts nothing more.
  An empty ask from "Add a widget" counts, because the member pressed ask:
  Langy gets "Help me build a dashboard".

## The query hash is keyed

`queryHash` is the first 16 hex characters of an HMAC-SHA256 of the statement
with its whitespace collapsed. The key is derived from the deployment secret
(`API_KEY_PEPPER`, else `CREDENTIALS_SECRET`, else `NEXTAUTH_SECRET`) under the
label `lwql-query-hash`, never the secret itself. The same query groups within
one deployment. Without the secret, a log line cannot confirm a guessed
statement or its literals. A deployment with none of the three refuses to boot,
as api-key already does.

The hash still groups queries, so keep it in internal logs only, never in a
product event or a customer-facing surface. Rotating the secret starts new
groups. Whether hashes and ids belong in logs and PostHog at all is still an
open question with Drew.

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

## Insights and alerts

Insight's own events reach PostHog through nurturing, once per event, on the
person who acted: `filed` (on the owner, else the filer), `seen`, `archived` and `kept`. No
title, body, query, board name or insight id is sent. `renewed` is not sent: a
renewal names no person, so there is nobody to count it on.

An alert's default email (the digest mail) and its default Slack message
mark their links to our own app's traces and charts with
`lw_from=alert`. Webhook bodies, custom templates and links to other sites are
sent unchanged. A signed-in member who opens a marked link sends one
`automations.opened.alert_link`, and the app's router then replaces the
current history entry without the marker, so Back, a reload, a copied link or
a later search update does not carry it or send the event again.

Not counted yet:

- **Triggers created, changed, turned on or off, fired or delivered.** Triggers
  have no change events, and a send is recorded only as a step of the trigger
  settlement outbox (`notifyDigest`), not as an event nurturing can subscribe
  to. These need their own plan.
  `lw.automation.trigger.match_recorded` is one per matched trace, not one per
  alert sent, so it is not used as "fired".
- **Report schedules configured, paused, resumed or settled.** Their events
  name no person: no actor is on the event or its envelope, and `configured` is
  also sent by the reconcile backfill. Sending them needs a person to send them
  on first, either the acting person added to the events or the organization's
  admin, which is a decision still to make.

## Not done yet

The production alert rule, the production CloudWatch log group and a check of
the production numbers after deploy are tracked in
https://github.com/langwatch/tasks/issues/1040 and need their own change to
production monitoring.
