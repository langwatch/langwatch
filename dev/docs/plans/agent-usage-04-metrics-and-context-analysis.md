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

## 3. Do not increment counters on the ingest stream

The natural reading of "fire off metrics as we ingest" is a counter incremented
per event. That is wrong here, and specifically wrong for this pipeline.

Coding-agent telemetry is **re-delivered**, and the design depends on that being
harmless — sessions fold into a `ReplacingMergeTree` and there is a scenario named
*"re-delivered telemetry does not inflate a session"*. A counter incremented on
the event stream has no such protection: a redelivery double-counts it, silently
and permanently.

So the rule is: **derive series from the deduped, folded tables — never by
incrementing on arrival.** That keeps every number replayable, which matters
because a corrected projection should be able to rebuild history rather than
leave a permanent scar in a counter.

The existing cost-drift counters are fine because they are operational signals
about the pipeline, not the customer's ledger.

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
- Session-grained series exist as a derived, replayable aggregate — not a counter
  incremented on arrival — bucketed on an anchor that does not move.
- Operational counters keep bounded labels and never gain a tenant dimension.
- A context-composition view exists for a session, built from derived floor plus
  locally measured sizes, with no prompt content stored anywhere.
