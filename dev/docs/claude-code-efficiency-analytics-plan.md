# Plan (draft): Coding-agent token-efficiency / waste analytics

Status: **draft for iteration** · Related: the Claude Code enhanced-telemetry feature (PR #5708) which supplies the per-span cost/token/cache data.

## Goal
Show *where coding-agent conversations waste tokens and money* — on two surfaces:
- **Per conversation** — an "Efficiency" view in the trace drawer.
- **Over time** — coding-agent efficiency in the analytics dashboards.

Generic across coding agents (Claude Code / Codex / OpenCode) off `gen_ai.usage.*`, with Claude-Code-specific depth (authoritative cost, cache-creation breakdown, sub-agents) lighting up when present. Gated on `origin = coding_agent`.

## The killer metric: cache re-creation
For Claude Code the waste isn't raw tokens — it's **cache invalidation**. Anthropic prices `cache_read` at 0.1×, fresh input 1×, `cache_creation` **1.25×**. A turn that re-creates a big cache is the expensive mistake. We have `cache_read`/`cache_creation` per `llm_request`, so we can pinpoint it AND attribute a cause:
- **Idle-gap re-cache** — turn came >5 min after the previous → the 5-min cache TTL expired → unavoidable. ("$3.20 re-caching after an 18-min gap.")
- **Mid-flurry invalidation** — cache dropped between back-to-back turns → the context prefix changed (early file edit / changed tool result / injected reminder) → *fixable*. ("Turn 14 invalidated 180K cached tokens mid-session.")

## What already exists (investigation, file:line)
- **Rollup** `00038_create_trace_analytics_rollup.sql:97-99,85-86` → `CacheReadTokensSum`, `CacheWriteTokensSum`, `CostSum`, `NonBilledCostSum` (per `Model`/`SpanType`/minute; keys are storage-only, per `route-table.ts:293-331`). Fed by `SpanCostService.extractCacheTokens` (`span-cost.service.ts:119-142`).
- **Analytics metrics** `analytics/registry.ts:76-159` — `performance.cache_read_tokens/cache_write_tokens/reasoning_tokens/total_cost/cost_billed/cost_non_billed/...` already registered → queried via `metric-translator.ts:429-607` (cache from `Attributes['langwatch.reserved.cache_read_tokens']`), rollup via `rollup-timeseries-query.ts:58-93`.
- **Origin filter** `route-table.ts:390-405` → `traces.origin` routes to slim `trace_analytics.Origin` (`00039:131`). No origin *group-by* yet.
- **Per-span** `tracer/types.ts:270-278` `Span.metrics.{cache_read_input_tokens,cache_creation_input_tokens,cost}` + `agent_id`/`query_source`/`request_id` on `Span.params`; cost enriched read-time onto `span.metrics.cost` (`claude-code-log-enrichment.ts:128-130`).
- **Per-trace header** `traces-v2/types/trace.ts:54-109` — `cacheReadTokens`, `cacheCreationTokens`, `totalCost`, `nonBilledCost`, `inputTokens`, `outputTokens`, `models`, `origin`.
- **Drawer surfaces** `TraceDrawerShell.tsx:287-362` (top-level `DrawerViewMode`) + `ConversationView.tsx:406-453` (sub-mode pattern, the just-added `terminal` mode is the template).

**So no new read plumbing is needed** for the drawer, and the raw over-time metrics already exist.

## Net-new work
1. **Ratio metrics** — no ratio primitive (a metric = one column). "Cache hit rate", "re-cache cost %": either client-side `asPercent` combine of two existing series, OR a new `performance.*` metric whose translator emits a ratio SQL expression (rollup builder would need a bespoke `sum(a)/sum(b)`).
2. **Cache-re-creation derivation** — not modeled anywhere. Needs logic over per-span `cache_creation_input_tokens` sequences (+ inter-turn time gaps for the idle-vs-flurry cause). Client-side for the drawer; a derivation/projection if we want it over-time.
3. **UI** — Efficiency drawer panel + dashboard graphs.
4. (optional) origin group-by dimension; Codex/OpenCode cache parity.

## Metrics (definitions)
- **Cache hit rate** = `cache_read / (cache_read + cache_creation + fresh_input)`.
- **Cost split** = output · cache_read · **cache_creation (re-cache waste)** · fresh input — minimize the re-cache slice.
- **Re-cache events** = per-turn `cache_creation` spikes, tagged idle-gap (>5min since prev turn) vs mid-flurry.
- **Redundant tool calls** (same tool+args repeated), **failed tool calls** (tool_result errors), **sub-agent cost** (per `gen_ai.agent.id`).

## Surface A — Drawer "Efficiency" view
- New `ConversationView` sub-mode (mirror `terminal`; gets conversation turns for free) OR a top-level `DrawerViewMode` "efficiency". Gated on `isTerminalOrigin`/coding-agent.
- Renders: cache-hit-rate gauge, cost-split bar, per-turn cost timeline with re-cache turns flagged + cause, redundant/failed-tool + sub-agent-cost callouts.
- Data: existing `Span.metrics` per span + `TraceHeader` aggregates + the new client-side re-cache derivation. **No server change.**

## Surface B — Analytics (over time)
- **Cache-hit-rate** metric (ratio — decide client-combine vs new translator expression) + a **cost-split** stacked graph (existing metrics) filtered to `origin=coding_agent`.
- **Leaderboard**: conversations/turns ranked by re-cache waste (needs the derivation available over-time — a rollup column or a query).
- (optional) origin group-by so "by coding agent" charts work.

## Generalization
- Generic (all origins): token/cost metrics.
- Cache: extractors normalize Claude `gen_ai.usage.cache_*`, Codex, OpenCode `ai.usage.cached*` to the same canonical keys (`_constants.ts:86-92`) — richest for Claude Code.
- Claude-specific: authoritative per-call `cost_usd` join, sub-agent `gen_ai.agent.id`, bundled-plan `nonBilledCost`.

## Phased build
1. **Drawer Efficiency panel** (highest value, zero server work): cache-hit-rate + cost-split + per-turn re-cache flags. Client-side re-cache derivation.
2. **Cache-hit-rate + cost-split analytics graphs** filtered to coding agents (ratio metric decision).
3. **Re-cache leaderboard over time** (derivation → column or query) + origin group-by.
4. Codex/OpenCode parity pass.

## Revision: the three-signal divide (metrics are the missing analytics source)

Investigation of Claude Code's OTLP output + our pipeline changed the shape of this plan. Keep a **clean divide** — each signal owns a different analytics story:

- **Spans → `trace_analytics` / `trace_analytics_rollup`** (exists). The execution tree, latency, per-span cost/tokens/cache. **Per-turn granularity.** Powers the drawer.
- **Metrics → a metrics-analytics path (NET-NEW — the real gap).** Claude Code emits a rich, documented metric set that we already ingest to `stored_metric_records` (`metric-request-collection.service.ts`, `metricRecordStorage.mapProjection.ts`) but **surface nowhere** — the analytics registry/translators only read the trace/span tables. These metrics are more authoritative + richer than span-derived data. **This is where the over-time efficiency AND productivity dashboards should draw from.**
- **Logs → per-trace enrichment (exists)** + *optionally* event-frequency analytics (tool/hook/skill/permission counts). **Do NOT fold logs into `trace_analytics`** — they're content + events, not a numeric time-series of the same shape. A logs-analytics table only if event-frequency analytics is wanted; lower priority.

### Claude Code documented metrics (all Counters; standard attrs: session.id, organization.id, user.*, terminal.type, + `OTEL_RESOURCE_ATTRIBUTES`)
| Metric | Measures | Key dims |
|---|---|---|
| `claude_code.cost.usage` | authoritative USD cost | `model`, `query_source` (main/subagent/auxiliary), `speed`, `effort`, `agent.name`, `skill.name`, `plugin.name`, `mcp_tool.name` |
| `claude_code.token.usage` | tokens | `type` (input/output/**cacheRead/cacheCreation**), `model`, `query_source`, `agent.name`, … |
| `claude_code.lines_of_code.count` | LOC modified | `type` (added/removed), `model` |
| `claude_code.commit.count` | git commits | — |
| `claude_code.pull_request.count` | PRs created | — |
| `claude_code.code_edit_tool.decision` | edit accept/reject | `tool_name`, `decision`, `source`, `language` |
| `claude_code.active_time.total` | engagement seconds | `type` (user/cli) |
| `claude_code.session.count` | sessions | `start_type` |
Note: **no `prompt.id` on metrics** (cardinality) — metrics correlate at session/project level, not per-turn. Some name attrs redact to "custom"/"third-party" unless `OTEL_LOG_TOOL_DETAILS=1`.

### Metrics-analytics path (the net-new infra)
`stored_metric_records` is stored but not query-wired for dashboards. Build a path to query it: either (a) a `metric_analytics_rollup` (mirror `trace_analytics_rollup`: sum by metric name + key dims + minute bucket) for fast over-time, or (b) a direct `stored_metric_records` query builder in the analytics routing. Register the CC metrics as analytics metrics (`registry.ts`) so they appear in custom graphs. This unlocks: cost-split by `query_source` (main vs subagent!), cache-hit-rate from `token.usage{type}`, and the productivity metrics (LOC / commits / PRs / active_time) — none of which spans can provide.

### Revised surface split
- **Drawer (per-conversation)** = **span-derived** (per-turn re-cache detection needs per-turn data; metrics are aggregate).
- **Analytics (over time)** = **metrics-driven** (cost/tokens/cache/LOC/commits/PRs/active_time; authoritative + richer).

## Dashboard UX (discovery)
- **Saved "Coding Agent" dashboard preset** — cost-split (main vs subagent via `query_source`), cache hit rate, LOC/commits/PRs over time, active-time, top-cost conversations.
- **Dynamic visibility** — show it only when the project has coding-agent data (a cheap existence check on `origin=coding_agent` traces or CC metrics), NOT a manual project toggle (toggles rot unset). Optionally a project-setting override.
- **Home-page discovery banner** — when coding-agent data is detected, a banner promoting the dashboard.
- **Personal-workspace home summary** — a "what's going on in your workspace" card on the home/`/me` page: personal cost / tokens / LOC / active time this week, off the same metrics (session/user-scoped).

## Open questions (to iterate)
- Ratio metric: client `asPercent` combine (cheap, no backend) vs a first-class `performance.cache_hit_rate` metric (reusable, needs translator + rollup expression). Lean client-side for v1, first-class if it's wanted as a dashboard primitive.
- Re-cache over-time: is per-conversation (drawer) enough for v1, deferring the over-time leaderboard (which needs a derivation)?
- `parent_agent_id` isn't a canonical key (only `gen_ai.agent.id`) — limits sub-agent-tree cost attribution; depends on the C6 linking work.
- Do we want a saved "Coding Agent Efficiency" dashboard preset, or just the metrics available in custom graphs?
