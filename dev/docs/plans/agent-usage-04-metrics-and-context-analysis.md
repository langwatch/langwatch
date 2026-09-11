# Part 4 — Metrics, dashboards, and context analysis

**Status:** design input. No ADR, no spec yet.
**Part of:** [ideation](agent-usage-advisor-ideation.md) ·
[1 trace fidelity](agent-usage-01-trace-fidelity.md) ·
[2 signals and surfacing](agent-usage-02-signals-and-surfacing.md) ·
[3 the hook advisor](agent-usage-03-cli-hook-advisor.md) ·
[5 practice adoption](agent-usage-05-practice-adoption.md)

Part 2 §6 wants history, trends and cohorts. There is nowhere to read them from:
**no materialised view, no bucketed series, no per-repo, per-user or per-model
roll-up anywhere.** Totals are computed by reducing at most 1,000 recent sessions
in process. This part is that missing floor.

---

## 1. Namespace into the registry that already exists

Metric identifiers are already `group.name`. `analyticsMetrics` is a nested
object whose top-level keys are the groups — `metadata.trace_id`,
`metadata.user_id`, `metrics.total_cost` — and each leaf declares `label`,
`colorSet`, `format`, `increaseIs`, `allowedAggregations` and an optional
`requiresKey`.

So a coding-agent family is **a new top-level key**, and everything downstream —
custom graphs, dashboards, the analytics query API, the CLI — accepts it without
knowing what it is:

```
coding_agent.cost                coding_agent.carry_ratio
coding_agent.cache_read_tokens   coding_agent.peak_context
coding_agent.session_count       coding_agent.session_lifetime_hours
coding_agent.tool_failure_rate   coding_agent.instruction_floor_tokens
coding_agent.compactions         coding_agent.shell_mutation_rate
coding_agent.skill_invocations   coding_agent.subagent_count
```

This is the cheapest large win in the whole programme. Declaring the family costs
a registry entry each; the work is in the data plane below.

## 2. Two different things are called metrics. Do not merge them.

| | operational | product analytics |
|---|---|---|
| question | is our ingest pipeline healthy | what is this customer's agent usage doing |
| store | OTel → Prometheus → our Grafana | ClickHouse → the customer's dashboards |
| labels | **bounded** — agent × model | tenant × repo × user × model × time |
| exists today | yes — `coding_agent_cost_computed_usd_total` and `_reported_usd_total`, fed by the cost-drift subscriber | no |

The failure mode to avoid is putting tenant, repository or user labels on the
Prometheus counters. That is an unbounded label set on a store that cannot take
it, and the blast radius is the monitoring system we use to find out that
anything else is broken. **Operational counters stay bounded; anything keyed by a
customer's own dimensions belongs in ClickHouse.**

## 3. Incrementing is the house pattern. The constraint is which keys, not whether to increment.

An earlier draft of this document said not to increment on the ingest stream.
That was wrong, and the codebase had already decided otherwise.

`trace_analytics_rollup` (ADR-034, migration 00038) is an **AggregatingMergeTree
written per-span by an app-side map projection**, not a ClickHouse materialised
view. Its columns are `SimpleAggregateFunction(sum, ...)` rather than full
`AggregateFunction(sum, ...)`, so the projection inserts **raw scalars over
JSONEachRow** — no `sumState`, no state converters, no `-State`/`-Merge`
ceremony — and reads are ordinary `sum(CostSum)`. Each immutable span contributes
one inserted row.

Re-delivery is handled by accepting it, explicitly: *"The only repeat is a rare
crash/retry re-delivery, which over-counts a single bucket by one span's
contribution. ADR-034 accepts that explicitly (negligible, non-systematic)."*

### Replay is truncate-first, not zero-first

The migration answers this directly: *"replay rebuilds the rollup truncate-first
rather than incrementing it."*

Writing a zero row would not work, and it is worth being precise about why: an
aggregating or summing engine **adds** every row it is given, so a `0` adds
nothing and clears nothing. The prior rows are still there. Resetting means
removing them — and `BucketStart` is the partition leaf, so a rebuild is a
partition-scoped drop and replay rather than a whole-table truncate.

### The real constraint, and it is the one that bites coding agents

From the same migration: *"Rollup keys are the dimensions final at span-write
time only… A key is stamped onto the increment when the span is written and can
never be re-stamped. Late / trace-level dimensions that flip during the fold
(topic, **origin**, user, conversation) are NOT keys here."*

Read that list again — **`origin` is named as a late dimension that flips.** And
`origin` is precisely how a coding-agent trace is identified. Coding-agent
dimensions are worse still: repository, branch and pull request are stamped onto
events from a session-context memo that a hook may deliver late; the session's
start time is a mutable anchor by design.

So the rule for this family is not "do not increment". It is:

- **Increment on immutable events** — a model call, a tool result, a compaction.
  Each of those arrives once and its dimensions are final when it is written.
- **Never increment on the session fold.** The session aggregate converges over
  many contributions *by design*; incrementing per contribution would over-count
  systematically rather than rarely, which is a different thing from what
  ADR-034 accepts.
- **Keep agent-reported cumulative metrics last-write-wins on the total.** The
  coding-agent metric contribution already carries `value` as a *converged total,
  LWW*, and `session_metric_series` is a `ReplacingMergeTree(AsOf)`. Agents report
  cumulative counters, and summing cumulative counters is simply wrong. Derived
  metrics we compute per immutable event can increment; reported ones cannot.
- **Do not key a rollup on a late dimension.** If repository or branch must be a
  key, it has to be resolved before the increment is written, or the rollup has
  to be rebuilt when the memo lands.

The existing cost-drift OTel counters are unaffected — they are operational
signals about the pipeline, not the customer's ledger.

## 3b. Shared pipeline, or a coding-agent one?

**Shared machinery, own table.** That is not a preference — it is what the
repository already does four times over. Each domain has its own rollup written
by its own app-side map projection:

- `trace_analytics_rollup` — traces, per span
- `evaluationAnalyticsRollup` — evaluations
- `metricTimeRollup` — the general metric-processing pipeline
- `governanceCostRollup` — governance cost

There is a general customer metrics path (`modules/metric`, with a
`metric-processing` pipeline and a request-collection service), and coding-agent
data should use the same *pattern* rather than the same *table*, for a concrete
reason rather than tidiness: **a rollup's value is its key set, and coding agents
need a different one.** `trace_analytics_rollup` keys on
`(TenantId, BucketStart, Model, SpanType)`. A coding-agent rollup needs agent,
harness, repository, branch and session-shape dimensions. Sharing the table would
force a choice between keying on dimensions that flip — which §3 forbids — and
not having the dimensions that make the metrics worth reading.

So: a fifth rollup, `coding_agent_analytics_rollup`, built the same way. Same
engine, same `SimpleAggregateFunction` scalars, same app-side projection, same
truncate-first replay, same retention column shape. Nothing novel to design, only
the key set to choose — and §3 says which dimensions are allowed to be keys.

## 4. The data plane, and a piece of good news

The analytics engine queries `trace_summaries` and `stored_spans` through an
aliased query builder. **Coding-agent turns are already traces in
`trace_summaries`**, carrying `langwatch.origin = coding_agent`.

That splits the work in two, and the first half is nearly free:

**Trace-grained metrics work today.** Cost, tokens, cache reads, carry ratio,
context size, counts — all of it is on traces the engine already reads. The one
missing piece is an **origin filter**: `analytics query` has no way to say
"coding agent only", which is why coding-agent cost per day cannot be charted
today even though the data is sitting there. Add the filter, declare the family,
and a large part of Part 2 §6 exists.

**Session-grained metrics need a real projection.** Session lifetime, peak
context, spend concentration, compaction counts and the power-law view are
session-grained, and `coding_agent_sessions` is not a source the analytics engine
knows. Two options: teach the query builder a new alias, or maintain an
aggregating materialised view bucketed by time.

One complication worth naming before someone hits it: the session's start time is
a **mutable storage anchor** — a late-arriving earlier signal can move it, and
there is already a scenario that a session must never be listed under a start
time it has moved off. A time-bucketed aggregate keyed on a movable anchor will
drift. Bucket on a frozen anchor, or accept and document the restatement.

`session_metric_series` already exists as a per-session store keyed
`(TenantId, SessionId, SeriesId)` — useful for a session's own totals, but it is
not time-bucketed, so it cannot answer "cost per day".

## 5. Context analysis — show what is actually in the window

The single most legible thing this product could show, and the closest analogue
is the `/context` breakdown people already read inside Claude Code. Same idea,
except ours persists, covers a whole session's history, and can be compared
across sessions and people.

The display is a composition of the context window at a point in time:

```
  ████████████  system prompt + tool definitions   ~40k     (57%)
  ██████        CLAUDE.md                          ~28k     (40%)
  ▌             skills index (15)                   ~2.3k    (3%)
  ░░░░░░░░░░░░  conversation + tool output        variable
  ·········     free
```

We can build this without ever capturing a prompt, which is the point:

- **The floor** is derived — the first measured context of a session is the
  static prefix, and across 236 sessions it bands tightly at p10 63,206 → median
  **70,151** → p90 81,463 tokens (Part 2 §4b).
- **The breakdown of that floor** comes from the local hook measurement in
  Part 3 §3.1b — sizes and counts only, never contents.
- **The growing part** is already reconstructible: working context sits on every
  event row, so the curve and its compaction resets are real data (they are only
  client-side today; Part 1 §8 folds them).
- **The tool-output share** is computable from `toolResultBytes`, and Part 5 §2
  shows why it is much larger than it looks.

Shown over a session's life rather than at one instant, this becomes the thing
that explains a bill: *here is where your 540k came from, and here is the moment
it stopped being worth carrying.*

## 6. Dashboards

Once the family is declared and the origin filter exists, the dashboard and
custom-graph machinery already in the product does the rest. The starter set
worth shipping as defaults, drawn from what the month actually showed:

- spend over time, split by model, with the Opus share as its own series;
- carry ratio over time — the one number that says whether anything is improving;
- sessions ranked by cumulative spend with the threshold line drawn across them;
- session lifetime distribution, since sessions over three days were 51.5% of
  spend;
- context floor per repository, which is the instruction-overhead bill;
- tool failure rate by tool, where Bash is the whole story at 5.3%.

## 7. Done when

- `coding_agent.*` is a declared family in the analytics registry.
- `analytics query` and the dashboards can filter by origin.
- A `coding_agent_analytics_rollup` exists, incremented per immutable event,
  keyed only on dimensions final at write time, rebuilt truncate-first.
- Operational counters keep bounded labels and never gain a tenant dimension.
- A context-composition view exists for a session, built from derived floor plus
  locally measured sizes, with no prompt content stored anywhere.
