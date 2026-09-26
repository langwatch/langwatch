---
name: dashboard-widgets
user-prompt: "Build me a custom chart widget"
description: Author a dashboard widget — a small React component backed by named LangWatchQL queries — from a plain question. Discovers the analytics schema, writes the queries, writes the widget file, saves it, then proves it renders. Use when asked to build, prototype, or iterate on a custom chart widget, or to add a widget beyond what a standard saved chart can express.
license: MIT
compatibility: Requires the `langwatch` CLI with a valid `LANGWATCH_API_KEY`, and a project with LangWatchQL analytics enabled. Works with Claude Code and similar coding agents.
feature-flag: release_custom_chart_playground
metadata:
  category: recipe
---

# Author a Dashboard Widget

Turn a question ("show cost per model as a bar chart") into a saved dashboard widget: one React file rendering data pulled through named LangWatchQL queries. The loop is: **discover the schema → write the queries → write the widget → save it → prove it runs**.

Reach for this instead of `lwql-charts` when the visualization is not a plain Vega-Lite spec over one query result — custom layout, multiple queries in one widget, conditional rendering, or anything a component can do that a declarative spec cannot.

## Prerequisites

LangWatchQL analytics is switched per project. If any command answers with error code `lwql_not_enabled`, the feature is off for this project — tell the user, do not retry.

Every `dashboard-widget` command runs against whatever project `LANGWATCH_PROJECT_ID` names in the environment. That variable is normally already set for you — do not invent a `langwatch project ...` command to look it up (there isn't one; `langwatch projects list` is the read command, plural). Only pass `--project <slug-or-id>` on a command yourself when you need to target a *different* project than the one already in scope. If a command fails with "No project is in scope", set `LANGWATCH_PROJECT_ID` or pass `--project` — do not retry the same call unchanged.

## Step 1: Discover the schema before writing any SQL

Never guess dataset or column names. The schema command lists every dataset your credentials may query, each column's type and description, and a runnable example query per dataset:

```bash
langwatch dashboard-widget schema -f json
```

Read the datasets, their grain, their time column, and which columns are `available` to you.

**Bound a dashboard widget's time window with the reserved `{dashboard_context_period_start:DateTime}` / `{dashboard_context_period_end:DateTime}` params (Step 2), not a hand-rolled `now()`/`subtractDays(...)` window.** A widget is meant to follow the dashboard's own period selector — a fixed window never does, and it also cannot be combined with `{dashboard_context_granularity_seconds:UInt32}`: the renderer refuses that combination with `lwql_granularity_requires_window`, since a granularity bucket needs the bounded window to bucket *within*.

**Seed data is stale** (newest trace 2026-08-04 as of this writing). While exploring the schema in this step — before you have a widget with the reserved period bounds wired in — a query against a narrow, hard-coded recent window can legitimately return 0 rows; that is not a bug, widen the window (e.g. `WHERE timestamp >= subtractDays(now(), 400)`) before assuming something is broken. Once the widget itself is written, prefer the reserved bounds over this kind of fixed window.

## Step 2: Write the queries file

`--queries-file` is a JSON array of named queries: `{ name, sql, parameters? }`. A widget's code calls a query by `name` — the two files are one unit.

- `parameters` declares what a `LW.query` call may pass for this query: each entry is `{ name, type, default? }`, where `type` is one of `"string" | "number" | "boolean"` (the JS type of the value, not the SQL type). Any key the widget code passes that is **not** declared here is rejected before any request fires — declare it or don't pass it.
- The reserved bound names `{dashboard_context_period_start:DateTime}`, `{dashboard_context_period_end:DateTime}`, `{dashboard_context_granularity_seconds:UInt32}` are opt-in: use them in a query's SQL and the executor fills them from the page's own time window automatically. The `dashboard_context_` prefix is reserved — supplied by the dashboard, read-only; author-declared params are separate. **Do not** add them to that query's `parameters` array, and never pass them yourself in a `LW.query` call — either mistake is refused with `dashboard_widget_query_reserved_param` / a schema validation error. On the dashboard-widgets authoring page, that window comes from a session-only range chip (1h / 24h / 7d / 30d, default 24h, resets on reload) — a query using the reserved bounds automatically re-runs when the chip changes. On a dashboard, a pinned widget instead follows that dashboard's own period selector.
- Your own bind parameters use the same ClickHouse-style SQL placeholder syntax as `lwql-charts` (`{since:DateTime}`, `{model:String}`, …), declared with their JS type in `parameters`.

```json
[
  {
    "name": "cost_by_model",
    "sql": "SELECT model, sum(costCents) / 100.0 AS cost FROM traces WHERE timestamp >= subtractDays(now(), 400) GROUP BY model ORDER BY cost DESC LIMIT 10",
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

- `data` is the query's result rows, or `null` until the first result lands. An empty array (`data.length === 0`) means the query genuinely returned zero rows — not an error; against stale seed data that is expected unless the SQL uses a wide window (see Step 1).
- `isLoading` is `true` only for the first fetch, before any data has ever landed. `isFetching` is `true` for any fetch in flight, including a background refetch — use it if you want to show a subtle "updating" state without clearing the chart.
- `isError` is `true` on failure; `error` is then an `Error` (`error.message`) — it never throws into the component. An undeclared param, a reserved-param misuse, or a SQL error all surface here instead of crashing the widget. `status` is `"pending" | "error" | "success"` if you prefer a single field to branch on.
- The hook auto-refetches when the page's time window changes, and when `params` changes by value — pass a plain object, not one you rebuild with a different identity every render for no reason. Call the returned `refetch()` to re-run it manually (e.g. from a button).

Always render all three branches (loading / error / data) — a widget that only handles the happy path shows nothing useful while data is stale-empty or a query is misconfigured.

Params are validated against the query's declared `parameters` before anything is forwarded to LangWatchQL — an undeclared key, or a required parameter with no default that is omitted, comes back through `error` rather than firing the request.

For code outside a component (or when you need a raw promise instead of hook semantics), `LW.query(name, params)` is the low-level escape hatch the hook is built on: it returns a promise that resolves to `{ rows, statistics }` or rejects with `{ code, title, message }`.

### Prebuilt charts: `@langwatch/charts`

Ten chart primitives, prebuilt and themed, so most widgets don't need to hand-roll a Recharts layout: `MetricStat`, `Sparkline`, `AreaTimeseries`, `StackedBars`, `GroupedBars`, `ProjectionBars`, `Donut`, `Leaderboard`, `Heatmap`. Plus `LwqlChart`, an auto-picker that infers a chart type (area / bars / donut / leaderboard / table) from a query's row shape — pass it `data`, and optionally `kind` to force one.

Every component consumes `LW.useChartQuery` rows directly and themes itself — no color or style props needed.

```jsx
export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("cost_by_model", {});

  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;

  return <LwqlChart data={data} />;
}
```

More worked examples: `platform/app/scripts/north-star-widgets/`.

#### `format`, not `yUnit`

`MetricStat`, `Leaderboard`, `AreaTimeseries`, `StackedBars` and `GroupedBars` take a `format` prop — there is no `yUnit`, `unit`, or similar; passing one is silently ignored (an unrecognized prop, not a compile error) and the axis/value renders as a bare number. `format` is one of exactly four strings:

| `format` | Renders `1410` as | Renders `0.141` as |
| --- | --- | --- |
| `"number"` (default) | `1,410` | `0.14` |
| `"currency"` | `$1,410` | `$0.14` |
| `"percent"` | `141,000%` | `14.1%` |
| `"duration"` | `1.4s` | `0ms` |

**`"percent"` multiplies by 100 itself — pass the 0-1 fraction, not the already-multiplied percentage.** Passing `14.1` (meaning "14.1%") renders `"1,410%"`; pass `0.141`.

#### Props per primitive

Every component also takes `data: Row[]` (the query result rows) and an optional `height?: number`; not repeated per row below.

| Component | Required props | Notable optional props |
| --- | --- | --- |
| `MetricStat` | `value`, `label` | `format`, `delta`, `deltaDirection` (`"up"` | `"down"`), `sparkline`, `sparklineKey`, `colors` |
| `Sparkline` | — | `x`, `y`, `color` |
| `AreaTimeseries` | `x`, `series` (string or string\[]) | `format`, `stacked`, `projectionFrom`, `colors` |
| `StackedBars` | `x`, `series` (string\[]) | `format`, `projectionFrom`, `colors` |
| `GroupedBars` | `x`, `series` (string\[]) | `format`, `colors` |
| `ProjectionBars` | `x`, `y`, `projectionFrom` | `budget`, `colors` |
| `Donut` | `nameKey`, `valueKey` | `centerLabel`, `colors` |
| `Leaderboard` | `labelKey`, `valueKey` | `format`, `max` (caps the bar scale, not the row count), `navigateTo` |
| `Heatmap` | `xKey`, `yKey`, `valueKey` | `xLabels`, `yLabels` (default to hour-of-day / weekday labels when `xKey`/`yKey` are exactly `"hour"`/`"weekday"`), `colorScale` (`[from, to]` hex pair) |
| `LwqlChart` | — (infers everything) | `kind` (forces the auto-picked type), `x`, `y`, `series`, `colors` |

### Drill-down: `LW.navigate`

`LW.navigate(target, params)` sends the user to another LangWatch page from inside a widget — `target` is `"traces"` or `"trace"`, and `params` is keyed by filter field ids (e.g. `"metadata.user_id"`) that the host resolves into the Trace Explorer URL.

`Leaderboard` wraps this for you: pass `navigateTo={{ target, params: (row) => ({ ... }) }}` and a row click navigates. An unknown `target` is ignored rather than erroring.

## Step 4: Save the widget, then prove it renders

```bash
langwatch dashboard-widget create \
  --name "Cost by model" \
  --code-file widget.tsx \
  --queries-file queries.json \
  -f json
```

**A successful `create`/`update` means "saved", not "renders".** It validates the queries file's shape and the widget's JS/TSX syntax, but it does not execute the queries or mount the component — a wrong column name, a bad SQL bind, or a runtime error in the widget only surfaces when it actually runs in the browser. There is no CLI command that runs a dashboard widget's queries with the dashboard's period params outside that render (unlike `langwatch chart run`, which does this for a saved chart's single statement) — so the only way to confirm a widget actually works is to open its `platformUrl` (printed on success) in a browser and look at it. Do not report the work done from a successful `create`/`update` alone.

## Managing saved widgets

**Widget ids can start with `-`.** They are nanoids, whose alphabet includes it, and a plain `langwatch dashboard-widget get -L4zZ...` reads the id as an unknown flag and fails. Always pass the id via `--id <id>`, never as the bare positional:

```bash
langwatch dashboard-widget list -f json
langwatch dashboard-widget get --id <id> -f json      # code, queries, platformUrl
langwatch dashboard-widget update --id <id> --code-file widget.tsx --queries-file queries.json
langwatch dashboard-widget delete --id <id>
langwatch dashboard-widget pin --id <id-or-name> --dashboard <id-or-name>   # add to a dashboard, next free row
langwatch dashboard-widget place --id <id> --dashboard-id <id> --grid-column 0 --grid-row 3 --col-span 4 --row-span 3   # add at an explicit grid position
langwatch dashboard-widget unplace --id <id>   # remove from its dashboard
```

`pin` reassigns the widget to that dashboard at the dashboard's next free row, keeping the widget's current size. `place` is the same assignment with an explicit grid position instead — the grid is 8 columns wide (`--grid-column`/`--col-span` in that unit), and `--grid-row` is still auto-allocated when omitted. Either way the widget still lives and is edited on the custom-chart-playground page. See `langwatch dashboard list` for ids.

`update` accepts `--name` on its own, a full definition (`--code`/`--code-file` together with `--queries-file`), or just one half of the definition (`--code`/`--code-file` alone, or `--queries-file` alone) — a half-definition update reads the widget's current value back for the side you didn't pass, rather than refusing or saving half a widget. A call with nothing to change (no `--name` and no definition flag at all) is still refused.

## Worked example: bar chart of daily trace counts

`widget.tsx`:

```jsx
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("daily_traces", {});

  if (isError) {
    return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  }
  if (isLoading || data === null) {
    return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  }

  const rows = data.map((row) => ({
    day: String(row.day).slice(0, 10),
    traces: Number(row.traces),
  }));

  return (
    <div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>{rows.length} rows</div>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fontSize: 10 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="traces" fill="#f97316" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

`queries.json`:

```json
[
  {
    "name": "daily_traces",
    "sql": "SELECT toStartOfDay(timestamp) AS day, count() AS traces FROM traces WHERE timestamp >= subtractDays(now(), 400) GROUP BY day ORDER BY day",
    "parameters": []
  }
]
```

Create it:

```bash
langwatch dashboard-widget create \
  --name "Daily traces" \
  --code-file widget.tsx \
  --queries-file queries.json \
  -f json
```

## Failure modes worth knowing

- `lwql_not_enabled` — the project's LangWatchQL switch is off; stop and say so.
- `custom_chart_playground_not_enabled` — the custom-chart-playground feature flag is off for this project; do not retry any `dashboard-widget` command, and do not fall back to guessing. Use the `lwql-charts` skill / `langwatch chart` commands for a saved dashboard chart instead.
- A save that succeeds but a blank or errored widget when opened — the SQL names a column that does not exist, or the component threw at render; re-read the schema (Step 1) and the error panel shown in the widget frame, then update.
- `dashboard_widget_query_undeclared_param` (shows up in the hook's `error`) — the widget code passed a param the query's `parameters` array doesn't declare; add the declaration or stop passing it.
- `dashboard_widget_query_reserved_param` (shows up in the hook's `error`) — the widget code passed `dashboard_context_period_start`, `dashboard_context_period_end`, or `dashboard_context_granularity_seconds` directly as a param; these are bound by the executor from the page window, never by the caller.
- `lwql_granularity_requires_window` — a query declares `{dashboard_context_granularity_seconds:UInt32}` without also declaring both `{dashboard_context_period_start:DateTime}` and `{dashboard_context_period_end:DateTime}` (or bounds the window itself with `now()`/`subtractDays(...)` instead). Add the reserved period bounds to the same query.
- "Cannot import '\<specifier>'" — the widget imported something other than `react`, `react-dom`, `react-dom/client`, `recharts`, or `@langwatch/charts`; use only those, or the corresponding global.
- A query returning 0 rows against seed data — the seed's newest trace is 2026-08-04; widen the time window before assuming the query is wrong.
