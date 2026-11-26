---
name: dashboard-widgets
user-prompt: "Build me a custom chart widget"
description: Author a dashboard widget — a small React component backed by named LangWatchQL queries — from a plain question. Discovers the analytics schema, writes the queries, writes the widget file, saves it, then proves it renders. Use when asked to build, prototype, or iterate on a custom chart widget, or to add a widget beyond what a standard saved chart can express.
license: MIT
compatibility: Requires the `langwatch` CLI with a valid `LANGWATCH_API_KEY`, and a project with LangWatchQL analytics enabled. Works with Claude Code and similar coding agents.
feature-flag: release_dashboards
metadata:
  category: recipe
---

# Author a Dashboard Widget

Turn a question ("show cost per model as a bar chart") into a widget on a dashboard: one React file rendering data pulled through named LangWatchQL queries. The loop is: **discover the schema → write the queries → write the widget → add it to a dashboard → prove it runs**.

A broad question ("Is our AI saving us time?", "Is quality holding?") still ends in a widget on the board. Pick the one or two numbers in the project's own traces that speak to it (traces handled per day, typical duration, the share that passed an evaluation), chart those, and say in your answer what the widget shows and what it cannot tell. Stay in this skill until the widget is on the board: do not switch to another skill or look for the answer outside the LangWatch data.

Reach for this instead of `lwql-charts` when the visualization is not a plain Vega-Lite spec over one query result — custom layout, multiple queries in one widget, conditional rendering, or anything a component can do that a declarative spec cannot.

## Prerequisites

LangWatchQL analytics is switched per project. If any command answers with error code `lwql_not_enabled`, the feature is off for this project — tell the user, do not retry.

The `langwatch dashboard` commands use the project of your API key. Only `langwatch dashboard widget schema` also reads `LANGWATCH_PROJECT_ID` and accepts `--project <slug-or-id>`; pass `--project` there only when you need a *different* project than the one in scope. Do not invent a `langwatch project ...` command to look the project up (there isn't one; `langwatch projects list` is the read command, plural).

## Step 1: Discover the schema before writing any SQL

Never guess dataset or column names. The schema command lists every view your credentials may query, each column's type and description, and a runnable example query per view. It is large (hundreds of kilobytes), so never print it whole: save it to a file, read the view names, then read only the view you need.

```bash
langwatch dashboard widget schema -f json > schema.json
jq -r '.views[] | "\(.name) (\(.timeColumn)): \(.description)"' schema.json
jq '.views[] | select(.name == "trace_metrics")' schema.json
```

Read the view's grain, its time column, and which columns are `available` to you. Write a view by its bare name, as `schema.json` gives it (`trace_metrics`, never `langwatch.trace_metrics`), so one query runs on LangWatch Cloud and on every self-hosted install. The views most questions need:

- `trace_metrics`: one row per trace with cost, latency, tokens, the user, conversation and `Source` (the origin). Traces, cost, latency and usage questions start here.
- `evaluation_metrics` and `trace_evaluation_metrics`: evaluation and online evaluation outcomes.
- `judgments`: Instant Eval verdicts, one row per run, trace and question. `langwatch instant-eval list -f json` gives each run's id and question; filter with `RunId = '<id>'`, and `Passed = 1` is a trace the question matched.
- `span_metrics` and `model_usage_by_minute`: per span and per model.

Every query reads the dashboard's own period: bound the view's time column with `{dashboard_context_period_start:DateTime}` and `{dashboard_context_period_end:DateTime}` (Step 2), never a fixed window such as `subtractDays(now(), 400)`. Try the statement once before writing the widget, with the dashboard period from your context: `langwatch query run "<sql>" --start "<period start>" --end "<period end>" --format json` (this command takes `--format`, not `-f`). Zero rows over the period is an answer, not a bug.

## Step 2: Write the queries file

`--queries-file` is a JSON array of named queries: `{ name, sql, parameters?, sources?, projects? }`. A widget's code calls a query by `name` — the two files are one unit.

- `parameters` declares what a `LW.query` call may pass for this query: each entry is `{ name, type, default? }`, where `type` is one of `"string" | "number" | "boolean"` (the JS type of the value, not the SQL type). Any key the widget code passes that is **not** declared here is rejected before any request fires — declare it or don't pass it.
- The reserved bound names `{dashboard_context_period_start:DateTime}`, `{dashboard_context_period_end:DateTime}`, `{dashboard_context_granularity_seconds:UInt32}` and `{dashboard_context_timezone:String}` (the reader's time zone, see "Time" below) are opt-in: use them in a query's SQL and the executor fills them from the page's own time window automatically. The `dashboard_context_` prefix is reserved — supplied by the dashboard, read-only; author-declared params are separate. **Do not** add them to that query's `parameters` array, and never pass them yourself in a `LW.query` call — either mistake is refused with `dashboard_widget_query_reserved_param` / a schema validation error. On the dashboard-widgets authoring page, that window comes from a session-only range chip (1h / 24h / 7d / 30d, default 24h, resets on reload) — a query using the reserved bounds automatically re-runs when the chip changes. On a dashboard, a pinned widget instead follows that dashboard's own period selector.
- `sources` lists the trace origins `{dashboard_context_sources:Array(String)}` is bound to, from `application`, `simulation`, `evaluation`, `sample`, `coding_agent`, `ai_tool`, `gateway`, `workflow`, `playground`, `langy` and `other` (any origin not listed). A query that names none counts `["application"]`, and a new widget is stored with that. Add an origin when the question is about those traces: `langy` for the user's own conversations with Langy (`TraceName = 'langy.turn'`, Langy's failed or refused requests), `simulation` for scenario runs. Without it, such a widget is always empty. An unknown name is refused.
- A query is kept to its `sources` **only where its SQL reads `{dashboard_context_sources:Array(String)}`**, for example `WHERE Source IN {dashboard_context_sources:Array(String)}` (the `Source` column of `trace_metrics` and `evaluation_metrics` is the origin: `application` for a missing one, `other` for an unlisted one; reach the other views through `(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM trace_metrics WHERE Source IN {dashboard_context_sources:Array(String)})`). A query that does not read it counts every origin, and the editor says "The SQL does not read {dashboard_context_sources}". Every run answers with `params`, a flat map of each placeholder the SQL declares by its SQL name (`dashboard_context_sources`, `dashboard_context_projects`, your own) plus the `period`. Read `diagnostics` too: `SOURCES_IGNORED` means the query counts every origin whatever `sources` holds, `SHARE_WINDOW_LIMITED` means a project shared only from some date on, so the rows start later than the period asked for, and `GRANULARITY_COARSENED` means the step ran coarser than asked.
- `projects` lists the project ids the query reads, bound to `{dashboard_context_projects:Array(String)}`. A query that names none reads its board's project. Name only projects the user can read; a project the writer cannot read, one that does not exist and one of another organization are all refused with `project_not_found` (404) and no id. A widget does not store `"all"` (it is for `langwatch query --projects all` and `run_query`, never in a queries file or `widget add --projects`); name the ids.
- `{dashboard_context_sources:Array(String)}` and `{dashboard_context_projects:Array(String)}` are reserved like the period names: type `Array(String)`, never in `parameters`, never passed by you, and never assigned or aliased in the SQL (`SET param_…`, `WITH … AS dashboard_context_projects`) — all are refused with `lwql_reserved_parameter_supplied`.
- Your own bind parameters use the same ClickHouse-style SQL placeholder syntax as `lwql-charts` (`{since:DateTime}`, `{model:String}`, …), declared with their JS type in `parameters`.

```json
[
  {
    "name": "cost_by_model",
    "sql": "SELECT Model AS model, sum(CostSum) AS cost FROM model_usage_by_minute WHERE BucketStart >= {dashboard_context_period_start:DateTime} AND BucketStart < {dashboard_context_period_end:DateTime} GROUP BY model ORDER BY cost DESC LIMIT 10",
    "parameters": []
  }
]
```

## Step 3: Write the widget file

One React/TSX file, default-exporting a component. **React and Recharts are available as globals** in the render iframe (`window.React`, `window.Recharts`) — no import needed, no build step (in-browser Babel compiles the file on load). You may also `import` from `"react"`, `"react-dom"`, `"react-dom/client"`, `"recharts"`, or `"@langwatch/charts"` if you prefer that style; these resolve to the same globals, and importing anything else is refused at compile time.

Fetch data with the `LW.useChartQuery(name, params)` hook, where `name` matches an entry in the queries file. It returns the same shape as TanStack Query's `useQuery` — same field names, on purpose:

```jsx
const { data, isLoading, isError, error } = LW.useChartQuery("cost_by_model", {});
```

- `data` is the query's result rows, or `null` until the first result lands. An empty array (`data.length === 0`) means the query genuinely returned zero rows — not an error: draw an empty state that says there is no data for the period.
- `isLoading` is `true` only for the first fetch, before any data has ever landed. `isFetching` is `true` for any fetch in flight, including a background refetch — use it if you want to show a subtle "updating" state without clearing the chart.
- `isError` is `true` on failure; `error` is then an `Error` (`error.message`) — it never throws into the component. An undeclared param, a reserved-param misuse, or a SQL error all surface here instead of crashing the widget. `status` is `"pending" | "error" | "success"` if you prefer a single field to branch on.
- The hook auto-refetches when the page's time window changes, and when `params` changes by value — pass a plain object, not one you rebuild with a different identity every render for no reason. Call the returned `refetch()` to re-run it manually (e.g. from a button).

Always render all three branches (loading / error / data) — a widget that only handles the happy path shows nothing useful while data is stale-empty or a query is misconfigured.

Params are validated against the query's declared `parameters` before anything is forwarded to LangWatchQL — an undeclared key, or a required parameter with no default that is omitted, comes back through `error` rather than firing the request.

For code outside a component (or when you need a raw promise instead of hook semantics), `LW.query(name, params)` is the low-level escape hatch the hook is built on: it returns a promise that resolves to `{ rows, statistics }` or rejects with `{ code, title, message }`.

### Colours and size: follow the dashboard

The widget runs in a frame on the dashboard, in the reader's light or dark theme. The frame sets the theme's colours as CSS variables, so use only these, written as `var(--chakra-colors-fg)`:

- `--chakra-colors-fg` (text), `--chakra-colors-fg-subtle` (labels, axes), `--chakra-colors-border-muted` (grid lines, tile borders)
- `--chakra-colors-bg-card` and `--chakra-colors-border-card` (a tooltip or panel), `--chakra-colors-fg-error`, `--chakra-colors-fg-success`
- `--chakra-colors-chart-1` to `--chakra-colors-chart-8` (series colours)

Never write a hex colour, `white` or a light background such as `#f8fafc`: a stat tile like that is a white block in dark mode. A tile has no background of its own, only a `1px solid var(--chakra-colors-border-muted)` border. `LW.theme` (`"light"` or `"dark"`) is there for anything the variables do not cover.

A new widget lands half the board wide and about 200 px tall inside. Fill that space rather than guessing a height: the outer element is `height: "100%"` and a flex column, at most one row of stat tiles goes on top, and the chart takes the rest (`flex: 1, minHeight: 0`, with `<ResponsiveContainer width="100%" height="100%">`). Never give a chart a fixed pixel height: one taller than the card hides its bars until the reader drags the card bigger.

### Time: bucket and label on the reader's clock

The reader can be in any time zone, and ClickHouse returns times in UTC. Never write "UTC" in a widget, and never cut a label out of a time string (`String(row.bucket).slice(5, 16)`): both show a reader in California data from the future.

- Bucket with `{dashboard_context_timezone:String}`. The dashboard fills it with the reader's IANA zone (UTC when the browser names none), like the period names: never in `parameters`, never passed by you.
- A fixed day or hour: `toTimeZone(toStartOfDay(OccurredAt, {dashboard_context_timezone:String}), 'UTC') AS day`, or `toStartOfHour` the same way. Keep the `toTimeZone(..., 'UTC')` wrapper: without it ClickHouse sends the reader's wall clock with no zone mark, and the label moves by the reader's offset.
- The board's grain: a day starts at the reader's midnight, and an hour or a minute stays a step of the instant, so the hour the clocks go back counts as two:

```sql
SELECT if({dashboard_context_granularity_seconds:UInt32} >= 86400, toTimeZone(toDateTime(toString(addSeconds(toStartOfInterval(subtractSeconds(toDateTime(toString(toDateTime(OccurredAt), {dashboard_context_timezone:String}), 'UTC'), 345600), INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND), 345600)), {dashboard_context_timezone:String}), 'UTC'), toDateTime(addSeconds(toStartOfInterval(subtractSeconds(OccurredAt, 345600), INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND), 345600), 'UTC')) AS bucket,
  count() AS traces
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
GROUP BY bucket ORDER BY bucket
```

- Label with `LW.formatTime(row.bucket)`: the reader's clock, "Nov 25, 4:00 PM" below a one-day grain and "Nov 25" at a day or week grain. Pass `Intl.DateTimeFormat` options to choose the fields, for example `LW.formatTime(row.day, { weekday: "short" })`. `LW.parseTime(row.bucket)` gives a `Date`. The `@langwatch/charts` components already label their axes and tooltips on the reader's clock when a query declares `{dashboard_context_timezone:String}`, and on UTC when none does.

### Prebuilt charts: `@langwatch/charts`

Ten chart primitives, prebuilt and themed, so most widgets don't need to hand-roll a Recharts layout: `MetricStat`, `Sparkline`, `AreaTimeseries`, `StackedBars`, `GroupedBars`, `ProjectionBars`, `Donut`, `Leaderboard`, `Heatmap`. Plus `LwqlChart`, an auto-picker that infers a chart type (area / bars / donut / leaderboard / table) from a query's row shape — pass it `data`, and optionally `kind` to force one.

Every component consumes `LW.useChartQuery` rows directly, themes itself and fills its card when you pass no `height` — no color or style props needed.

```jsx
export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("cost_by_model", {});

  if (isError) return <div style={{ fontSize: 11, color: "var(--chakra-colors-fg-error)" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "var(--chakra-colors-fg-subtle)" }}>Loading…</div>;

  return <LwqlChart data={data} />;
}
```

### Drill-down: `LW.navigate`

`LW.navigate(target, params)` sends the user to another LangWatch page from inside a widget. `target` is a route key, never a path: `"traces"` and `"trace"` take `params` keyed by filter field ids (e.g. `"metadata.user_id"`) or `traceId`, which the host resolves into the Trace Explorer URL; `"scenarios"`, `"onlineEvaluations"`, `"annotations"`, `"gatewayVirtualKeys"`, `"codingSessions"` and `"modelCosts"` (Settings, Model costs) open that page and take no params; `"metadataDocs"` opens the metadata and labels docs page in a new tab.

`Leaderboard` wraps this for you: pass `navigateTo={{ target, params: (row) => ({ ... }) }}` and a row click navigates. An unknown `target` is ignored rather than erroring.

## Step 4: Add the widget to a dashboard, then prove it renders

A widget always lives on a dashboard; pick one first (see **Dashboards** below), then:

```bash
langwatch dashboard widget add <dashboardId> \
  --name "Cost by model" \
  --code-file widget.tsx \
  --queries-file queries.json \
  -f json
```

Creating (and updating) validates the queries file's shape and the widget's JS/TSX syntax, but it does not execute the queries or mount the component — a wrong column name or a runtime error in the widget only surfaces when it actually runs. Open the widget's `platformUrl` (printed on success) and confirm it renders with real data before calling the work done.

## Dashboards and their widgets

A dashboard is the page widgets live on. The dashboard the user is on arrives in your context with its id: a chart they ask for there goes on that board, even when they say "now a chart of..." or "another dashboard" without naming one. If they name a different existing dashboard, the chart goes on that one. **Create a board** only when they ask for a separate or new board by name ("make a new dashboard called X"), or they are on no board and none fits. When you do create one, say so in the first line of your reply and name it, so they know where to look.

```bash
langwatch dashboard list -f json                          # ids, names, widget counts
langwatch dashboard get <dashboardId> -f json
langwatch dashboard create "<name>" -f json               # empty dashboard; prints platformUrl
langwatch dashboard update <dashboardId> --name "<name>"  # rename; or --description / --clear-description
langwatch dashboard delete <dashboardId>                  # removes the dashboard and its widgets
langwatch dashboard widget list <dashboardId> -f json
langwatch dashboard widget get <dashboardId> <widgetId> -f json   # code, queries, platformUrl
langwatch dashboard widget add <dashboardId> --name "<name>" --code-file widget.tsx --queries-file queries.json -f json
langwatch dashboard widget update <dashboardId> <widgetId> --code-file widget.tsx --queries-file queries.json
langwatch dashboard widget update <dashboardId> <widgetId> --sources application,langy   # every query counts these
langwatch dashboard widget update <dashboardId> <widgetId> --projects A,B   # every query reads these projects
langwatch dashboard widget delete <dashboardId> <widgetId>
```

`add` places the widget at the dashboard's next free row — edit it from the widget's menu on that dashboard. `langwatch analytics-report list` lists the old Analytics Reports, which hold no widgets.

**Which dashboard:** place on the dashboard the user named; if they named none, on the dashboard they are on. If no dashboard is in context, ask which one with the `question` tool, one option per dashboard from `langwatch dashboard list` with its id in `ref`. If that list is empty, create a board named after what they asked for and say so in the first line of your reply. Never choose between existing dashboards for the user.

- **Never pick a dashboard for the user.** When more than one dashboard fits, ask with the `question` tool (a choices card): one option per dashboard from `langwatch dashboard list`, its id in `ref`.
- **Confirm before any delete** of a dashboard or widget with a choices card (`Delete "NAME"?` with Delete and Keep), and run the command only on Delete. Deleting a dashboard takes its widgets with it.
- The project needs Dashboards switched on. A 404 with `dashboards_not_released` means it is off: tell the user, do not retry.

`--sources` and `--projects A,B` on `widget add` or `update` set the same list on every query of the widget, and override `sources` and `projects` in the queries file. `widget update` accepts `--name`, `--description`, `--sources` or `--projects` on its own, or a full definition (`--code`/`--code-file` together with `--queries-file`) — passing one definition flag without the other is refused locally rather than saving half a widget. A call with nothing to change is refused too.

## Worked example: bar chart of daily trace counts

`widget.tsx`:

```jsx
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const color = (name) => `var(--chakra-colors-${name})`;

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("daily_traces", {});

  if (isError) {
    return <div style={{ fontSize: 11, color: color("fg-error") }}>{error.message}</div>;
  }
  if (isLoading || data === null) {
    return <div style={{ fontSize: 11, color: color("fg-subtle") }}>Loading…</div>;
  }
  if (data.length === 0) {
    return <div style={{ fontSize: 11, color: color("fg-subtle") }}>No traces in this period.</div>;
  }

  const rows = data.map((row) => ({
    day: LW.formatTime(row.day, { month: "short", day: "numeric" }),
    traces: Number(row.traces),
  }));
  const total = rows.reduce((sum, row) => sum + row.traces, 0);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, color: color("fg-subtle") }}>{total.toLocaleString()} traces</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid stroke={color("border-muted")} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: color("fg-subtle") }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: color("fg-subtle") }} />
            <Tooltip
              contentStyle={{ background: color("bg-card"), border: `1px solid ${color("border-card")}` }}
            />
            <Bar dataKey="traces" fill={color("chart-1")} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

`queries.json`:

```json
[
  {
    "name": "daily_traces",
    "sql": "SELECT toTimeZone(toStartOfDay(OccurredAt, {dashboard_context_timezone:String}), 'UTC') AS day, uniqExact(TraceId) AS traces FROM trace_metrics WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime} AND Source IN {dashboard_context_sources:Array(String)} GROUP BY day ORDER BY day",
    "parameters": []
  }
]
```

Add it:

```bash
langwatch dashboard widget add <dashboardId> \
  --name "Daily traces" \
  --code-file widget.tsx \
  --queries-file queries.json \
  -f json
```

## Failure modes worth knowing

- `lwql_not_enabled` — the project's LangWatchQL switch is off; stop and say so.
- `custom_chart_playground_not_enabled` — dashboard widgets are not enabled for this project (they need Dashboards and LangWatchQL); do not retry any `langwatch dashboard widget` command, and do not fall back to guessing. Use the `lwql-charts` skill / `langwatch chart` commands for a saved dashboard chart instead.
- A save that succeeds but a blank or errored widget when opened — the SQL names a column that does not exist, or the component threw at render; re-read the schema (Step 1) and the error panel shown in the widget frame, then update.
- `dashboard_widget_query_undeclared_param` (shows up in the hook's `error`) — the widget code passed a param the query's `parameters` array doesn't declare; add the declaration or stop passing it.
- `dashboard_widget_query_reserved_param` (shows up in the hook's `error`) — the widget code passed `dashboard_context_period_start`, `dashboard_context_period_end`, `dashboard_context_granularity_seconds` or `dashboard_context_timezone` directly as a param; these are bound by the executor from the page window, never by the caller.
- "Cannot import '\<specifier>'" — the widget imported something other than `react`, `react-dom`, `react-dom/client`, `recharts`, or `@langwatch/charts`; use only those, or the corresponding global.
- A query returning 0 rows over the dashboard's period — the project has no matching data in that window; say so in the widget's empty state rather than widening the window.
