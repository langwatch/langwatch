---
name: beautiful-dashboards
user-prompt: "Rebuild the agent-economics dashboards"
description: The design language and board-by-board recipes for LangWatch's ten agent-economics dashboards — token burn, shipping, building speed, context health, harness, the market, checkout health, customer billing, and the two engineering finops boards. Each board is a set of dashboard widgets built from the shared `@langwatch/charts` primitives over the agent-economics LangWatchQL views. Use when asked to build, rebuild, or restyle one of these boards, or to make any custom dashboard widget look like they do.
license: MIT
compatibility: Requires the `langwatch` CLI with a valid `LANGWATCH_API_KEY`, a project with LangWatchQL analytics enabled, and the agent-economics views (`agent_sessions`, `agent_session_events`, `pull_requests`, `finops_usage`).
feature-flag: release_custom_chart_playground
metadata:
  category: recipe
---

# Beautiful dashboards

Ten dashboards that turn coding-agent telemetry into money and time a person can act on. This recipe is the **design language** they share and the **board-by-board recipe** for every card on them: its name, its one-line subtitle, its size on the grid, the LangWatchQL its widget runs, and the widget file itself.

Build one card the way the `dashboard-widgets` skill teaches — discover the schema, write the queries, write the widget, save it, prove it renders — and reach here for *what* to build and *how it should look*. The two skills are one pipeline: `dashboard-widgets` owns the mechanics (`LW.useChartQuery`, the reserved period bounds, `create`/`place`/`pin`), this one owns the taste and the catalogue.

## How this recipe is laid out

Each board's cards live beside this file, one folder per card:

```
recipes/<board-slug>/board.json                     # title, hint, ordered cards + grid placement
recipes/<board-slug>/<card-slug>/widget.tsx          # the React widget, default-exporting a component
recipes/<board-slug>/<card-slug>/queries.json        # the named LangWatchQL queries it runs
```

Read `board.json` first — it is the running order and the grid. Then open one card's `widget.tsx` + `queries.json`, `create` it, and `place` it at the column/row/span `board.json` names. Do not paste every card into context at once; load them one at a time.

To rebuild a whole board:

```bash
for card in $(jq -r '.cards[].slug' recipes/<board-slug>/board.json); do
  id=$(langwatch dashboard-widget create \
        --name "$(jq -r --arg c "$card" '.cards[]|select(.slug==$c).name' recipes/<board-slug>/board.json)" \
        --code-file "recipes/<board-slug>/$card/widget.tsx" \
        --queries-file "recipes/<board-slug>/$card/queries.json" \
        -f json | jq -r '.id')
  # then place it — read col/row/span from board.json for this card
done
```

`create` prints the widget id (it can start with `-`; always pass it back as `--id <id>`). `place` puts it on the grid; `board.json` carries the exact `gridColumn` / `gridRow` / `colSpan` / `rowSpan` for each card:

```bash
langwatch dashboard-widget place --id <id> --dashboard-id <dashboard-id> \
  --grid-column <c> --grid-row <r> --col-span <cs> --row-span <rs>
```

## The design language

Every card obeys the same rules. A board looks like one system because the cards do.

### Card anatomy

- **Title** — a plain-English noun phrase, three or four words. "Where it went, by pull request", not "PR cost breakdown".
- **Subtitle** — one line, the question the card answers or how to read it. Sentence case, a full stop, no jargon. The subtitle lives in `board.json` (`sub`), not in the widget; the card chrome renders it.
- **Header stat (optional)** — one big number the eye lands on first, sometimes with a verdict badge beside it (see below). Put it above the chart.
- **Body** — one chart primitive. One card, one idea. If you need two ideas, that is two cards.

### Colour and tone

Colour carries meaning, never decoration. Import the ramp and semantics from `@langwatch/charts`:

- `TOKENS.ramp` — the categorical series ramp (`#4299e1 #ed8926 #9f7aea #48bb78 #ed64a6 #38b2ac #0bc5ea #ecc94b`). Series 1 is `ramp[0]`, and the same entity keeps the same index across every card — use `fixedColor(name)` to pin a named entity ("Claude Code", "Engineering", a model id) to a stable colour everywhere it appears.
- Semantic tones: `TOKENS.ok` (`#38a169`, good/healthy/saving), `TOKENS.warn` (`#ed8926`, watch this), `TOKENS.danger` (`#e53e3e`, over budget / rate-limited / wasted), `TOKENS.faint` (`#9ca3af`, the baseline/typical/"you are here" reference), `TOKENS.muted` (`#5c5c6e`, secondary text).
- A cost line is `TOKENS.ramp[0]` (accent); a "typical"/baseline line or band is `TOKENS.faint`; anything the card is warning about is `TOKENS.danger`.

### Verdict badges

When a number is only meaningful against an expectation, say the verdict in a `Badge`: `<Badge text="+18% vs typical" tone="warn" />`. Tone rules: `ok` when the trend is good (cost falling, cache healthy, ahead of plan), `warn` when it crosses a soft threshold (spend pace >15% over typical, cache 60–90%), `danger` when it breaches a hard one (over budget, cache below 60%, more than 3× median). A badge states the comparison in words — never a bare arrow.

### Formats

Never render a raw number. Use `formatValue(v, fmt)` or a primitive's `format` prop, with one of: `currency` ($1,410 / $0.14), `number` (1,410), `tokens` (1.2M / 12.3k), `tokens_k` (fixed-k, "314k"), `percent` (pass the 0–1 fraction, it multiplies), `duration_min` (minutes → "38 min" / "1.2h"). Money is `currency`. Token counts are `tokens` (or `tokens_k` on a context-size axis where every value is in the same k range). A share is `percent` on the 0–1 fraction. Spell words out in labels — "tokens", "requests", "OpenAI" — never "tok", "req", "oai".

### The grid — 8 columns, 100px rows

The dashboard grid is **8 columns** wide and rows are **100px** tall (`platform/app/src/server/analytics/chartGrid.ts`).

- **Half card** — `colSpan: 4`. Two per row (columns 0 and 4). The default width.
- **Full card** — `colSpan: 8`. A header stat row (StatTiles), a gauge, a Gantt, a leak list, a wide time series.
- **Height** — a stat/summary row is `rowSpan: 2`; a normal chart is `rowSpan: 3`; a gauge, Gantt, or leak list that needs room is `rowSpan: 4`.
- The prototype's `/me` boards were a 2-column grid; on the 8-column grid a half is `colSpan 4` and a full (its old `wide: true`) is `colSpan 8`. The company boards' **3-up rows become 4+4 half pairs**, and each **3-up stat trio collapses into one full-width `StatTiles`** rather than three separate cards.

### Choosing the primitive

| The card shows… | Primitive |
| --- | --- |
| A row of big numbers (a summary header) | `StatTiles` |
| One big number + optional trend | `MetricStat` |
| Things ranked, each clickable, with an icon and a sub-line | `RankedList` |
| Things ranked with a proportional bar under each | `BarList` |
| A share of a whole, few categories | `Donut` |
| A value over time, one or few series | `LineChart` (or `AreaTimeseries` for a filled single series) |
| Stacked or grouped bars over time / per category | `Bars` (`stacked`), `GroupedBars` for budget-vs-actual pairs |
| Bars with a projected/faded tail + a budget line | `ProjectionBars` |
| Bars + a line on a second axis | `ComboChart` |
| A 0–1 health reading with coloured zones | `Gauge` |
| Days coloured by a daily count (contribution calendar) | `CalendarHeatmap` |
| Hour × day intensity grid | `Heatmap` |
| A distribution across fixed buckets | `Histogram` |
| Points scattered against two axes (compactions, per-call context) | `ScatterDots` |
| A median + a few sample points per category | `DotStrip` |
| Sessions as bars across a 24h timeline | `Gantt` |
| A small dense grid of numbers | `Table` |
| Just infer a chart from a query's row shape | `LwqlChart` |

Reference lines and bands sharpen a chart: `LineChart`/`Bars` take `referenceLines` (`{y, label, color, dashed}`) and `referenceAreas` (`{y1, y2, label, color, opacity}`). Use a `faint` dashed line for a target/optimum, a `danger` dashed line for an alert threshold, and a faint band for a "healthy range".

### Every card degrades gracefully

Render all four states, in this order, every time:

```tsx
if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No agent telemetry yet. Connect a coding agent and this card fills itself.</div>;
```

The empty state is copy, not a blank frame — it tells the reader why the card is empty and what to do. No chart junk: no gridlines that carry no information, no legend a colour-keyed label already says, no axis title that repeats the card title.

## The data map — which view answers which question

Query the agent-economics views as `analytics.<view>`; tenant scoping is automatic, so never add a tenant filter. Bound every time-series query with the reserved dashboard bounds so the card follows the page's period selector:

```sql
WHERE StartedAt >= {dashboard_context_period_start:DateTime}
  AND StartedAt <  {dashboard_context_period_end:DateTime}
```

(Three cards keep a fixed 7-day window instead — `leaks`, `tool-round-trips`, `pace` — because they are "this week" readings; they use `subtractDays(now(), 7)` and declare no reserved bounds.)

The views and the questions they answer:

- **`agent_sessions`** — one row per coding-agent session (`SessionId`, `StartedAt`, `Title`, `RepositoryName`, `RepositoryOwner`, `GitBranch`, `CostUsd`, `InputTokens`, `OutputTokens`, `CacheReadTokens`, `CacheCreationTokens`, `ToolCounts` Map, `ToolDurationMs` Map, `Skills` Array, `McpServers`, `McpTools`, `SubAgentTypes`, `Models`, `PeakContextTokens`, `Compactions`, `CacheRebuildCount`, `LargestCacheRebuildTokens`, `RateLimited`, `ApiErrors`, `RetryMs`, `BlockedOnUserMs`, `ActiveTimeCliSec`, `Commits`, `PullRequests`, `IsFork`, `UserId`). Answers: spend and tokens per session, cost by session, peak context, rate limits, active vs waiting, commits.
- **`agent_session_events`** — one row per event within a session (`SessionId`, `TimeUnixMs`, `EventKind` = `model_call`|`tool_call`|`tool_result`|`compaction`|`api_error`…, `Model`, `InputTokens`, `CacheReadTokens`, `CacheCreationTokens`, `OutputTokens`, `CostUsd`, `DurationMs`, `PreTokens`, `PostTokens`, `CompactionTrigger`, `StatusCode`, `RetryDurationMs`, `ToolName`, `ToolResultBytes`, `AgentType`, `QuerySource`, `PromptId`). Answers: context size per call, compaction points, tool round-trips, retries/429s, steps per prompt, subagent context. **`TimeUnixMs` is a `DateTime64(3)`, not an epoch integer** — compare it directly to the reserved bounds (`TimeUnixMs >= {dashboard_context_period_start:DateTime}`) and bucket it with `toDate(TimeUnixMs)`; never wrap it in `fromUnixTimestamp64Milli`.
- **`pull_requests`** — one row per PR (`PrNumber`, `Title`, `RepositoryFullName`, `HeadBranch`, `State`, `IsDraft`, `AuthorLogin`, `PrCreatedAt`, `PrClosedAt`, `PrMergedAt`, `HtmlUrl`). Answers: what shipped, when it merged. A PR is **merged** when `PrMergedAt IS NOT NULL` (do not filter `State = 'merged'` — `State` is `open`/`closed`). `agent_sessions` carries `RepositoryOwner`+`RepositoryName` but not a full name, so join sessions to PRs on `concat(RepositoryOwner, '/', RepositoryName) = RepositoryFullName` and `GitBranch = HeadBranch`.
- **`finops_usage`** — the finance rollup (`Day`, `Charge` = `usage`|`seat`|`cloud`|`activity`, `Tool`, `Provider`, `Agent`, `Model`, `PersonId`, `PersonName`, `TeamName`, `DepartmentId`, `DepartmentName`, `Resource`, `KeyId`, `Requests`, `Units`, `Unit`, `TokensIn`, `TokensOut`, `CacheRead`, `CacheWrite`, `Errors`, `Cost`, `ListCost`). Answers everything on the two engineering boards, customer billing (`KeyId`), and the market board (`Cost` vs `ListCost`).

### Canonical LangWatchQL snippets

Reuse these shapes; the per-card `queries.json` is a concrete instance.

**Token classes + cache hit rate** (one row, the burn header):

```sql
SELECT sum(CacheReadTokens) AS cache_read,
       sum(CacheCreationTokens) AS cache_write,
       sum(InputTokens - CacheReadTokens - CacheCreationTokens) AS fresh,
       sum(OutputTokens) AS output,
       sum(CostUsd) AS cost,
       sum(CacheReadTokens) / nullif(sum(CacheReadTokens + CacheCreationTokens + (InputTokens - CacheReadTokens - CacheCreationTokens)), 0) AS hit_rate
FROM agent_sessions
WHERE StartedAt >= {dashboard_context_period_start:DateTime} AND StartedAt < {dashboard_context_period_end:DateTime}
```

**Cost per PR** (session↔PR join on repo+branch):

```sql
SELECT p.PrNumber AS pr, any(p.Title) AS title, any(p.RepositoryFullName) AS repo, sum(s.CostUsd) AS cost
FROM agent_sessions AS s
INNER JOIN pull_requests AS p
  ON concat(s.RepositoryOwner, '/', s.RepositoryName) = p.RepositoryFullName AND s.GitBranch = p.HeadBranch
WHERE s.StartedAt >= {dashboard_context_period_start:DateTime} AND s.StartedAt < {dashboard_context_period_end:DateTime}
GROUP BY pr ORDER BY cost DESC LIMIT 6
```

**Before/after PR-open split** (doing vs babysitting): sum `s.CostUsd` where `StartedAt < p.PrCreatedAt` as `doing`, the rest as `babysitting`, per PR.

**Context percentiles per day**:

```sql
SELECT toDate(TimeUnixMs) AS day,
       quantile(0.5)(InputTokens + CacheReadTokens + CacheCreationTokens) / 1000 AS p50,
       quantile(0.9)(InputTokens + CacheReadTokens + CacheCreationTokens) / 1000 AS p90,
       max(InputTokens + CacheReadTokens + CacheCreationTokens) / 1000 AS max_k
FROM agent_session_events
WHERE EventKind = 'model_call'
  AND TimeUnixMs >= {dashboard_context_period_start:DateTime}
  AND TimeUnixMs <  {dashboard_context_period_end:DateTime}
GROUP BY day ORDER BY day
```

**Compaction dots**: `EventKind = 'compaction'`, select `day`, `round(PreTokens/1000)` as `at_k`, `CompactionTrigger` as `trigger`.

**Oversized-context spend**: `sum(greatest(ctx - 450000, 0)) / 1e6 * <cacheReadRate>` per day over `model_call` events.

**Tool round-trips**: `EventKind = 'tool_result'` → `ToolName`, `count()`, `max(ToolResultBytes)`, `sum(ToolResultBytes)`, token estimate = bytes/4.

**Active vs waiting**: `sum(ActiveTimeCliSec)/60` and `sum(BlockedOnUserMs)/60000` from `agent_sessions` grouped by `toDate(StartedAt)`.

**Reply-latency buckets**: gap between an agent's last output and the next user turn, bucketed `<1m / 1-5m / 5-15m / 15-60m / >1h` (from `agent_session_events` turn timestamps).

**Parallelism by hour**: concurrent session count per hour × day from `agent_sessions` start/end.

**Overnight runs**: `agent_sessions` whose `StartedAt` hour is 00:00–07:00.

**Harness elements**: `arrayJoin(Skills)` / `arrayJoin(McpServers)` / `mapKeys(ToolCounts)` from `agent_sessions`, counted and joined to per-session cost/PR outcomes.

**FinOps by dept / tool / charge**: `finops_usage` grouped by `DepartmentName` / `Tool` / `Charge`, `sum(Cost)` (or `sum(ListCost)` for list rates), `Day` between the bounds.

**Budget vs actual**: `finops_usage` actual `sum(Cost)` per month against the plan constants below (a `Plan` model does not exist yet — the budget curve is authored in the widget).

### Plan / budget constants (Engineering budget board)

There is **no `Plan` model in the product yet**. The Engineering budget board's budget curves are authored constants in those widgets, marked clearly:

```ts
// PLAN CONSTANTS — no Plan model exists yet; these are the authored ENG_2026 plan.
const ENG_2026_AMOUNT = 240_000;            // annual department budget, USD
const ENG_2026_PHASING = [0.85, 0.88, 0.91, 0.94, 0.97, 1.0, 1.03, 1.06, 1.09, 1.12, 1.14, 1.15]; // ramp 0.85→1.15, ×(amount/12)
const ENG_2026_CLAUDE_AMOUNT = 84_000;      // child plan, same ramp phasing
const ENG_2026_DBX_AMOUNT = 66_000;         // child plan, FLAT phasing (÷12 each month)
const LIST_RATE_FACTOR = 1.28;              // list ÷ negotiated; multiply negotiated cost by this for list-rate view
```

`monthBudget(month)` for the parent/Claude plans = `amount/12 * phasing[month]`; for the Databricks plan it is the flat `amount/12`.

## The boards

Ten boards. Each row below is one card: its folder slug, the primitive, and its grid placement (`col`,`row` = `gridColumn`,`gridRow`; `w`,`h` = `colSpan`,`rowSpan`). Full names and subtitles live in each `board.json`.

### 1. Token burn — `recipes/token-burn/`

*Where your tokens and money go: by pull request, by actor, by token class, by model.*

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `burn-summary` | StatTiles | 0,0 | 8,2 |
| `expensive-sessions` | RankedList | 0,2 | 4,3 |
| `by-pr` | BarList | 4,2 | 4,3 |
| `spend-by-model` | Bars (stacked, daily) | 0,5 | 4,3 |
| `pace` | LineChart (band + line + rate-limit dots, fixed 7d) | 4,5 | 4,3 |
| `cache-gauge` | Gauge + RankedList | 0,8 | 8,4 |
| `tool-round-trips` | RankedList (fixed 7d) | 0,12 | 4,3 |
| `main-vs-subagents` | Bars (stacked, daily) | 4,12 | 4,3 |
| `leaks` | BarList (leak findings, fixed 7d) | 0,15 | 8,4 |

### 2. What I shipped — `recipes/shipped/`

*What your merged pull requests cost in assistant usage.*

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `value-per-token` | StatTiles | 0,0 | 8,2 |
| `shipping-calendar` | CalendarHeatmap | 0,2 | 4,3 |
| `cost-per-pr` | Bars (two reference lines) | 4,2 | 4,3 |
| `babysit` | Bars (stacked) | 0,5 | 4,3 |
| `pr-leaderboard` | RankedList | 4,5 | 4,3 |
| `output-vs-spend` | ComboChart | 0,8 | 8,3 |

### 3. Building speed — `recipes/building-speed/`

*Your sessions through the day: parallel work, idle time, what ran at night.*

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `today` | Gantt | 0,0 | 8,4 |
| `waiting-on-you` | RankedList | 0,4 | 4,3 |
| `reply-latency` | Histogram | 4,4 | 4,3 |
| `parallel-heatmap` | Heatmap | 0,7 | 4,3 |
| `overnight` | RankedList | 4,7 | 4,3 |
| `active-waiting` | Bars (stacked, daily) | 0,10 | 8,3 |

### 4. Context health — `recipes/context-health/`

*How big your context runs and where you compact. Smaller context means cheaper calls.*

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `context-per-call` | LineChart (band + alert line) | 0,0 | 8,3 |
| `compaction` | ScatterDots (+ optimum line) | 0,3 | 4,3 |
| `call-cost` | BarList | 4,3 | 4,3 |
| `oversized-context` | Bars (daily) | 0,6 | 4,3 |
| `subagent-context` | DotStrip | 4,6 | 4,3 |
| `steps` | Histogram | 0,9 | 8,3 |

### 5. My harness — `recipes/harness/`

*The skills, MCP servers and CLIs you installed: adoption, effect, speed.*

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `harness-effect` | BarList (verdict badges) | 0,0 | 8,3 |
| `tool-mix` | BarList | 0,3 | 4,3 |
| `clis-mcps` | RankedList | 4,3 | 4,3 |
| `harness-changes` | RankedList (change badges) | 0,6 | 4,3 |
| `skills-in-use` | RankedList | 4,6 | 4,3 |
| `harness-speed` | Table | 0,9 | 4,3 |
| `dead-weight` | RankedList | 4,9 | 4,3 |

### 6. The market (theoretical) — `recipes/market/`

*Your real traffic priced on other vendors' public rate cards. Prices only, no quality adjustment.*

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `sub-vs-api` | StatTiles + LineChart | 0,0 | 8,3 |
| `provider-replay` | BarList | 0,3 | 8,3 |
| `context-fit` | BarList | 0,6 | 4,3 |
| `cache-sensitivity` | LineChart | 4,6 | 4,3 |
| `peak-hours` | LineChart (reference areas) | 0,9 | 8,3 |

### 7. Checkout health — `recipes/checkout-health/`

*A project board: cost, errors and error rate over time.*

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `cost-over-time` | LwqlChart (line) | 0,0 | 4,3 |
| `errors-over-time` | LwqlChart (line) | 4,0 | 4,3 |
| `error-rate` | LineChart (percent) | 0,3 | 4,3 |

### 8. Customer billing — `recipes/customer-billing/`

*The gateway's spend and traffic by customer key.*

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `spend-by-key` | BarList | 0,0 | 4,3 |
| `gateway-spend` | LwqlChart (line) | 4,0 | 4,3 |
| `requests-over-time` | AreaTimeseries | 0,3 | 4,3 |

### 9. Engineering 2026 — `recipes/engineering-2026/`

*The engineering department's AI spend: seats, tokens and cloud compute together.*

The three prototype stat cards (AI cost, adoption, cost of a question) collapse into one full-width `StatTiles`. The 3-up panels become 4+4 halves.

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `finops-summary` | StatTiles | 0,0 | 8,2 |
| `pct-cost-by-tool` | Donut | 0,2 | 4,3 |
| `cost-evolution` | Bars (stacked, monthly) | 4,2 | 4,3 |
| `cost-by-tool` | BarList | 0,5 | 4,3 |
| `cost-by-agent` | BarList | 4,5 | 4,3 |
| `cost-by-model` | BarList | 0,8 | 4,3 |
| `cost-by-user` | BarList | 4,8 | 4,3 |
| `genie-questions` | AreaTimeseries | 0,11 | 4,3 |
| `tokens-over-time` | AreaTimeseries | 4,11 | 4,3 |
| `committed-vs-metered` | Bars (stacked, by charge) | 0,14 | 8,3 |

### 10. Engineering budget 2026 — `recipes/engineering-budget-2026/`

*The engineering annual budget against actual spend, phased month by month.*

Stat trio collapses into one full-width `StatTiles`. Budget curves are the authored plan constants above.

| card | primitive | col,row | w,h |
| --- | --- | --- | --- |
| `budget-summary` | StatTiles | 0,0 | 8,2 |
| `budget-vs-actual` | GroupedBars | 0,2 | 4,3 |
| `budget-vs-actual-by-month` | GroupedBars | 4,2 | 4,3 |
| `pct-cost-by-dim` | Donut | 0,5 | 4,3 |
| `cost-evolution` | Bars (stacked, monthly) | 4,5 | 4,3 |
| `claude-cost-evolution` | Bars (stacked, seat vs usage) | 0,8 | 4,3 |
| `claude-consumption` | AreaTimeseries (tokens) | 4,8 | 4,3 |
| `trend-projection` | ProjectionBars (+ budget line) | 0,11 | 8,3 |
| `claude-vs-budget` | GroupedBars | 0,14 | 4,3 |
| `dbx-evolution` | Bars (stacked) | 4,14 | 4,3 |
| `dbx-vs-budget` | GroupedBars | 0,17 | 4,3 |
| `trends-by-dim` | LineChart (indexed to 100) | 4,17 | 4,3 |

## Prove it renders

A save is not a render. After `create` and `place`, open the printed `platformUrl` and look at the card — a wrong column name or a runtime throw only shows there. The whole point of these boards is that they look right; confirm it with your eyes, not a green `create`.
