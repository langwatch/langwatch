# Ideation: background tracking and recommendations for coding-agent usage

**Date:** 2026-09-11
**Status:** ideation only. No ADR, no spec, no code.
**Origin:** PR #7536 cost $28,654 in coding-agent spend. The diagnosis happened
once, by hand, after the money was gone.

## The three parts

This document is the evidence and the argument. The work splits into three
pieces, in dependency order:

| | part | one line |
|---|---|---|
| 1 | [Trace fidelity](agent-usage-01-trace-fidelity.md) | Stop marking a whole turn failed. Report rates, type the fields, code the errors. Nothing downstream is trustworthy until this lands. |
| 2 | [Signals and surfacing](agent-usage-02-signals-and-surfacing.md) | What went wrong on this trace, and whether it is improving over history. Includes skills — used well, badly, or not at all. |
| 3 | [The advisor in the hooks](agent-usage-03-cli-hook-advisor.md) | Tell the agent in-session what to enable, and stop the big spends. |
| 4 | [Metrics and context analysis](agent-usage-04-metrics-and-context-analysis.md) | A `coding_agent.*` family in the existing analytics registry, so dashboards come free — plus a breakdown of what is actually in the context window. |
| 5 | [Practice adoption](agent-usage-05-practice-adoption.md) | What a team has not adopted yet, and what adopting it is worth, priced on their own traffic. |

Sections 1–11 below are the shared evidence base all five draw on.

**One mechanic runs through all of them.** Context is re-read, so the cost of
anything put into it is its size multiplied by how long it survives. Measured
across three sessions, tool output injected 2.73M tokens and caused **71.87M**
carried re-reads — a **26.3× amplification**, and 29.1× in the longest session.
Every estimate in Parts 2, 4 and 5 is computed on carried tokens; anything
computed on injected tokens understates the cost by more than an order of
magnitude.

---

## 1. What actually happened, and why it is a product

On 2026-09-11 at 09:07 a Langy conversation opened with:

> so i spent quite some money on this PR, langwatch#7536. i want you to
> investigate it to help me figure out where i could be making the biggest
> savings in: speed, unnecessary looping, usage

Langy answered well. It found the model split, the resumed-context problem, the
standing `/loop`, the lane concurrency and the PR size, and it ranked the
savings. Six follow-up turns later it had produced a handoff protocol, which
landed in `442b11c726`.

Three things are wrong with that, and all three are the product:

1. **It was late.** The analysis ran after $28,654 had been spent.
2. **It was hand-driven.** A human noticed the bill, chose the PR, asked the
   question, and steered six follow-ups. Nothing would have happened otherwise.
3. **It was never verified.** A protocol was landed. No measurement says
   whether it worked.

The platform already stores everything needed to do this continuously. What is
missing is judgement, delivery, and proof.

---

## 2. The metric to lead with: carry ratio

**Carry ratio = cache-read tokens ÷ completion tokens.** How much history the
model re-read for every token of work it produced.

Measured on this account:

| Scope | cache-read | completion | carry ratio |
|---|---:|---:|---:|
| PR #7536 (110 sessions) | 43.2B | 87.7M | **493 : 1** |
| 200 recent traces (8 sessions, 3 days) | 629.7M | 1.70M | **370 : 1** |
| One $19.44 turn, Opus calls only | 26.3M | 24,488 | **1,076 : 1** |
| Same turn, Sonnet permission classifier | 7.79M | 1,370 | **5,689 : 1** |

`prompt_tokens` is **2** on 5,491 of 7,718 model calls in the largest session.
Essentially nothing is being sent. Everything is being re-read.

The usual objection is that the cache is working. It is: a cache read is priced
around a tenth of an input token. But a tenth of the price at 370x the volume is
still 37 full-price input tokens burned per token of output produced. The cache
is not solving this. It is making it affordable enough not to notice.

Carry ratio is the right headline because it is unit-free, comparable across
models, harnesses and people, and every one of its remedies is a concrete
behaviour: compact earlier, end the session, write a handoff, shrink the
instruction block, narrow the tool output.

Supporting measures, all computable today:

- context size per model call (the growth curve)
- compactions, and whether they were automatic or manual
- session wall-clock and idle gaps
- resume and fork depth
- static instruction overhead — the context floor every turn pays

---

## 3. What the growth curve actually looks like

From `langwatch session events` on this account:

```
session 0a5117b3   Opus   23h   9 prompts   $99.14   0 compactions
  context:  72.7k → 100k → 178k → 254k → 341k → 454k → 534k
            └───────────── monotonic, nothing intervenes ─────────────┘

session b20f71f1   28h   188 prompts   >20,000 events   5 compactions (all MANUAL)
  context:  69k → 238k → 116k → 425k → 148k → 243k → 141k …
            └── sawtooth: a human hit /compact, five times, late ──┘
  $357.85 in the first 20,000 events alone.  124 subagent completions.
```

The first session is the failure with no brakes. The second is the `/loop`
coordinator, and the brakes were pulled by hand, after 256k, five times.

Median context across the sample is 262k. p90 is 437k. Max is 540k.

Nothing in the product noticed either of these while they were happening.

---

## 4. The signal library

A signal is a named, versioned detector with a threshold, a piece of evidence,
and a costed remedy. Families below; **Today** says whether the data to compute
it already exists.

### A. Context economics

| Signal | Detects | Today | Remedy |
|---|---|---|---|
| `context.unbounded_growth` | context rises past a ceiling with no compaction | yes | checkpoint, hand off, restart fresh |
| `context.carry_ratio_high` | carry ratio above threshold over the last K turns | yes | end the lane now |
| `context.late_compaction` | compaction fires at a high pre-token count, or only manually | yes | compact earlier, or do not resume at all |
| `context.idle_hold` | session idle for hours, then resumes carrying everything | yes (a 20h gap is in the sample) | close it; start from the handoff |
| `context.instruction_overhead` | the static prefix every turn pays for | approx. (context floor = 32,150 observed) | trim instructions; report it in $/month |

### B. Model routing

| Signal | Detects | Today | Remedy |
|---|---|---|---|
| `routing.premium_on_mechanical` | premium model doing repetitive edits with low reasoning output | yes | route to a cheaper model, with a counterfactual $ |
| `routing.classifier_tax` | auxiliary model calls inside a turn re-reading full context | yes | allowlist the tool patterns |
| `routing.fleet_cost` | the total cost of one orchestration decision across every lane it spawned | **partly** | attribution; feeds the others |

`routing.fleet_cost` is the one that needs new folding. `parentSessionId` and
`isFork` are stored, and `depth`, `spawn_mode` and `parent_agent_id` are lifted
off the wire, but no projection folds them and there are **no per-subagent
tokens, cost or duration** — only counts, ids and types. So the shape of a fleet
is known and its cost is not. For an orchestration-heavy user that is the single
most valuable thing missing.

`routing.classifier_tax` is worth stating on its own. In the most expensive
turn observed, **61 Sonnet permission-classifier calls cost $1.92 — 10% of the
turn — to produce 1,370 tokens of output**, because each yes/no decision carried
the whole conversation. A tool allowlist deletes that line item.

### C. Loop and cadence

| Signal | Detects | Today | Remedy |
|---|---|---|---|
| `loop.regular_cadence` | inter-prompt gaps clustering on a fixed interval — a timer, not a decision | yes | event checkpoints instead of ticks |
| `loop.no_progress_tick` | a turn that changed no file and opened no new target | needs file churn | stop the loop |
| `loop.repeat_tool_call` | the same command run N times in one session | yes (command text on tool spans) | the agent is stuck; intervene |

### D. The tool boundary

| Signal | Detects | Today | Remedy |
|---|---|---|---|
| `tool.wide_output` | a tool result above N bytes pulled into context | yes — `resultSizeBytes` is on every tool span | narrow the command |
| `tool.blocked_on_user` | wall-clock lost waiting for a permission decision | yes — `blocked_on_user` spans exist | allowlist |
| `tool.failure_storm` | the same command failing repeatedly (20 shell failures in the sample) | yes — `success` on tool spans | the agent is looping on something broken |

`tool.wide_output` compounds, which is what makes it worth a signal rather than
a lint. A 50KB grep result is not a one-off charge. It is re-read on every
subsequent turn of that session, at the carry ratio, for as long as the session
lives.

### E. Orchestration shape

| Signal | Detects | Today | Remedy |
|---|---|---|---|
| `orchestration.concurrency_rework` | concurrent sessions on one branch, correlated with files edited by more than one of them | yes | cap concurrent lanes |
| `orchestration.resume_depth` | a session forked from a session that was itself forked | yes — parent and fork are recorded | start fresh from a handoff |

### F. Outcome — the missing half

| Signal | Detects | Today | Remedy |
|---|---|---|---|
| `outcome.cost_per_landed_change` | spend divided by work that survived to merge | partly — PR linkage exists, merge/revert join does not | the only ranking that is fair |
| `outcome.reverted_spend` | money spent on work later reverted | no | — |

Cost alone is a bad target. A $17 session that lands a working slice is a good
trade; a $17 session that gets reverted is pure loss. Every league table in this
product should be denominated in cost per landed change, never cost.

---

## 5. The three tiers

```
                 latency        where it runs            what it can do
  ┌───────────┐
  │ REAL-TIME │  seconds       the agent's own hooks     prevent the spend
  └───────────┘                the gateway, in flight    refuse or downgrade
        │
  ┌───────────┐
  │  SIGNAL   │  minutes       on session events         name it, cost it,
  └───────────┘                as they land              remedy it
        │
  ┌───────────┐
  │ AGGREGATE │  hours/days    scheduled roll-ups        rank it, trend it,
  └───────────┘                                          benchmark it
        │
  ┌───────────┐
  │  VERIFY   │  weeks         before/after on applied   prove it, or retire
  └───────────┘                recommendations           the recommendation
```

### Real-time

Two channels, and both already exist.

**The hook channel is the important one.** The LangWatch plugin already owns a
`SessionStart` hook that injects `additionalContext` directly into the model
(`sdks/typescript/src/cli/plugin/session-guidance-entry.ts`), plus a `Stop`
hook, mapped across harnesses in `opencode-plugin.ts`. Today it carries one
static sentence. The comment on that constant already states the right idea:

> Written to the agent, not the user: it is injected into the session's own
> context, and the agent is the one who has to act on it mid-session.

Make that sentence computed. At session start, the agent reads a brief about
itself:

> Your last five sessions in this repository averaged a 380:1 carry ratio. Two
> passed 450k context without compacting. Checkpoint at 200k and write a
> handoff rather than continuing.

That is the highest-leverage delivery surface in the product, because the agent
is the actor and it is awake when the human is not. `PreCompact` is the second
one worth having: the moment a session decides to compact is the exact moment to
say *write a handoff and stop instead*.

**The gateway channel is the enforcement one.** LangWatch already proxies the
traffic and already has spend budgets and virtual keys. It sees a request before
it is billed, so it can warn on a response header, stop on budget, or refuse a
call whose context exceeds a policy ceiling. Keep this opt-in and advisory by
default — a guardrail that kills a session mid-slice costs more than the tokens
it saved.

### Signal-based

Detectors run over session events as they land and emit a **Finding**:

```
code                      context.unbounded_growth
severity                  ranked by money, not by taxonomy
scope                     session | pull request | repository | person | org
evidence                  trace ids, event ids, one quoted command
measured                  tokens, dollars, wall-clock
estimated_recoverable     $/week, and the method used to estimate it
remedy                    a concrete action: a config line, a routing rule,
                          a settings change, a skill to run
status                    open | applied | dismissed | regressed
```

Findings deduplicate into issues, the way an error tracker does: one code plus
one repository is one issue that accrues occurrences and dollars, not forty
alerts. Rank by recoverable spend and show the top few. A finding worth $3 a
week should never reach a human.

**This tier has a prototype already, and it is most of the argument.**
`modules/coding-agent/web/src/trace/session-signals.ts:59-172` computes twelve
named signals per session: truncated, rate-limited, retries-exhausted,
retry-time over 10s, cache-churn over 25%, compacted, blocked-on-user over 60s,
tools-denied, hooks-blocked, failed-tools, refusals, permission-changed.
`trace/context-health.ts:24-61` bands context at 20/40/60/80% of the window, and
`trace/token-timeline.ts:61-80` already detects cache rebuilds.

All of it runs **in the browser, when a drawer is opened, for one session at a
time**. Nothing is persisted, nothing is priced, nothing carries a remedy, and
nobody sees it unless they go looking at a session they already suspect.

So the work is not inventing signals. It is moving these server-side, giving
each one a dollar figure and a remedy, letting them run across sessions rather
than inside one, and delivering them somewhere other than a drawer.

One honest correction on reuse: automation triggers and monitors do **not**
currently reach this data. Triggers are `AUTOMATION | ALERT | REPORT` over trace
and graph data (`modules/automation/contract/src/trigger.ts:11`), monitors run at
`trace|thread` level (`modules/monitor/contract/src/monitor.ts:4,117`), and
neither subscribes to the `span/log/metric_facts_contributed` stream that
coding-agent data flows through. Gateway budgets key on virtual keys and spend
events, with no coding-agent reference anywhere in `modules/gateway`. Delivery
needs wiring; it is not free.

### Aggregate-based

- **Per pull request.** The report already exists, with per-model cost and even
  billed-versus-bundled split (`specs/coding-agent/pull-request-linkage.feature`,
  135 scenarios). Add a verdict and a ranked savings list to it.
- **Per repository, person, team, harness, model.** Carry ratio, context curve,
  cost per landed change, concurrency, rework rate.
- **Trends.** Is the carry ratio falling? From which change?
- **Benchmarks.** Against your own past first. Against anonymised cross-org
  percentiles second, opt-in — *"teams shipping changes this size average
  140:1"*. Only a platform holding many organisations can produce that, which is
  what makes it defensible.
- **The weekly review.** An auto-generated document that reads like the Langy
  answer above, ranked by recoverable spend, evidence linked. Generate it from
  the aggregates and a sample of evidence, never from raw traces — the advisor
  has to be cheap.

### Verification

Every applied recommendation gets a before and after:

> Default lane routing changed 12 Sep. Carry ratio down 41%. Realised saving
> $4.1k over 14 days.

This is what turns a report into a system. It also disciplines the signal
library: a detector whose remedies never move the metric gets retired.

---

## 6. What exists already

This is a judgement layer on a pipeline that is already collecting the right
things. That is the argument for building it.

| Already there | Where |
|---|---|
| 24 canonical log events and 8 metrics, normalised from each agent's own OTel output | `modules/coding-agent/contract/src/telemetry/coding-agent-definition.ts:30-74` |
| ~90 lifted scalars including `tool_result_size_bytes`, `parent_session_id`, `is_fork`, `depth`, `spawn_mode`, `query_source`, `agent_type`, `trigger`, `pre/post_tokens` | `coding-agent-normalization.ts:277-386` |
| Per-call event rows with tokens, cost, duration, tool bytes, decision, compaction trigger and working context | `coding_agent_session_events` (migration 00073, 00087) |
| A session fold with ~80 measures — `peakContextTokens`, `cacheRebuildCount`, `compactionTriggers`, `blockedOnUserMs`, `toolsDenied`, `filesTouched`, `linesAdded/Removed`, `editsAccepted/Rejected`, `commits`, `parentSessionId`, `isFork` | `contract/src/coding-agent.ts:28-126` |
| Repo/branch/worktree declaration from a hook, memoised 180d in Redis and stamped onto every later event | `session-context.ts:243-303`, `session-context-memo.repository.ts:9-28` |
| PR join with 30s throttle, 10-min fleet recheck, 90-day install backfill | `pull-request-mapping.subscriber.ts:28`, `github-branch-recheck.process.ts:15` |
| PR usage with billed vs non-billed cost and a per-model breakdown | `coding-agent.ts:391-429`, `/api/v1/coding-agent/pull-request-usage` |
| **Twelve per-session signals and context-health bands** | `web/src/trace/session-signals.ts:59-172`, `context-health.ts:24-61` |
| Sessions table already showing Context, Compactions, Active-and-waiting, Token cost, Pull requests | `web/src/sessions-table-header.tsx:19-62` |
| A hook that injects text into the agent's context, on every tracked harness | `sdks/typescript/src/cli/plugin/session-guidance-entry.ts` |
| Gateway in the request path, with virtual keys and spend budgets | `services/aigateway` |
| A pull-based insight skill ladder | `specs/skills/agent-insight-skills.feature` |

Two things worth calling out.

**The $28,654 number came from a CI script, not the product.**
`.github/workflows/pr-token-usage.yml` runs `.github/scripts/pr-token-usage.ts`,
which calls the v1 endpoint and upserts a sticky bot comment on the PR. It is
repo CI, not anything in `modules/github`. The most useful cost surface anyone
here has is a shell script in our own repository. Productising that comment —
with a verdict and ranked savings rather than a table of totals — is a short
path to value for every customer.

**The skill ladder is the clearest contrast.** It points at the customer's
production agent, and a human has to ask. This points at the coding agent, and
nobody has to ask.

---

## 7. Capture gaps worth closing

Two kinds: things declared but not arriving, and things never modelled.

**Declared, but empty in practice** — worth a bug before a feature:

- **`rate_limit` never fires.** It is a canonical event with two wire aliases
  (`coding-agent-normalization.ts:148-192`) and a stored row kind, yet zero
  appeared across 8,614 model-call events. The 19 real rate limits in the sample
  surfaced only as trace error prose with null cost.
- **`ttft_ms` is a zero placeholder** on 7,718 of 7,718 events. `turn_ttft`
  exists in the vocabulary; the value does not arrive.
- **`statusCode` and `errorType` are empty** on every model-call event observed,
  so a retry cannot be told from a failure.

**Never modelled:**

- **No time series anywhere.** There is no ClickHouse materialised view, no
  bucketed series, no per-repo, per-user or per-model roll-up. `usageTotals`
  reduces at most 1,000 recent sessions in process
  (`session-read.service.ts:160-193`). The whole aggregate tier is greenfield,
  and `analytics query` has no origin filter and would not bucket by day.
- **No per-subagent cost.** Counts, ids and types only. `depth`, `spawn_mode`
  and `parent_agent_id` are lifted and never folded. Sub-agent tool steps are
  dropped from `steps`, which is itself capped at 100.
- **No per-call context series server-side.** The events table carries working
  context per row, but the fold keeps only `peakContextTokens` and the
  compaction before/after. The growth curve in section 3 exists only because the
  browser reconstructs it on drawer open (`token-timeline.ts:3-13`).
- **No turn aggregate.** `prompt.id` and `event.sequence` are on rows; nothing
  groups a turn.
- **No cadence, idle or gap derivation** beyond `blockedOnUserMs` and the
  agent-reported active time.
- **No rework measure.** No per-file edit counts, no diff size, no repeat-edit
  detection, no re-run detection.
- **No merge or revert join.** Branch and PR are joined; commit SHA is not.
  Cost is known and value is not.
- **Cross-harness parity is thin.** Codex produces no `model_call` rows, no cost
  metric and no lines-of-code (`telemetry/codex.ts:37-38`). Gemini and Copilot
  have definitions, but the wire vocabulary is Claude-centric. Any signal shipped
  today is effectively Claude Code only.

---

## 8. Risks

- **This is per-person telemetry.** "Tracking people's coding agent usage" reads
  as surveillance unless the defaults say otherwise. Team aggregates by default;
  individual detail visible to the individual; anything manager-facing opt-in and
  policy-gated. The personal-workspace separation already exists — lean on it.
- **Optimising the wrong number.** Rank on cost per landed change. Ranking on
  cost rewards the person who does not use agents.
- **Noise.** Costed, deduplicated, dismissible, few. Otherwise it is Dependabot
  for spend and people will turn it off.
- **The advisor's own cost.** It should cost well under 1% of what it saves, and
  it should publish that number in the product.
- **False positives.** A 500k context is sometimes exactly right. Every finding
  needs a "this was correct" dismissal that feeds the threshold.

---

## 9. Where I would start

The smallest build that would have caught the $28,654, using no new ingestion:

1. Compute carry ratio and the context curve per session. The data is there.
2. Ship three detectors: `context.unbounded_growth`,
   `routing.premium_on_mechanical`, `tool.wide_output`.
3. Deliver to two places only — the PR report, where you already look, and the
   `SessionStart` hook, where the agent can act.
4. Add the verification pass, so the next change to the protocol is measured
   rather than asserted.

Everything past that is worth planning properly: an ADR for the Finding object
and the detector registry, and a spec per signal family.

---

## 10. Queued: widen the sample before committing to thresholds

Everything above is drawn from **one person, one project, three days, 200
traces**. Every threshold in the signal library is therefore a guess dressed up
in a real number. Before any of it is specced, run the same analysis over a
wider sample:

- a **random** sample of traces and sessions across the last month, not a
  cherry-picked one — the point is to find patterns we have not already named,
  so the sampling must not be steered by the signals we already believe in;
- **several projects**, not just this one, so a pattern can be told apart from a
  personal habit;
- **other people's sessions**, for the same reason.

Two practical notes on that last one.

**Access.** The device login reads only the personal project. Anything wider
needs a project or organization API key, and the cross-project read has to go
through an org-scoped key rather than borrowing someone's session.

**Personal workspaces are deliberately isolated.** `specs/coding-agent/personal-usage.feature`
has a scenario called *"usage is mine alone"*, and the product enforces it. That
isolation is a feature, and reaching around it to read colleagues' sessions is
the exact thing section 8 warns about. For finding missed patterns, aggregate
statistics per person — carry ratio, context curve, model mix, cadence — answer
the question without anyone reading anyone else's prompts or transcripts. If
transcript-level detail turns out to be needed, that is worth asking the team
for rather than assuming, and it is worth knowing that the answer shapes what
the product should default to as well.

The output of that pass should be: which thresholds survive contact with more
data, which signals turn out to be one person's habit, and what shows up that is
not in section 4 at all.

---

## 11. Follow-up: one month, 16,980 turns, 240 sessions

Section 10 said every threshold above was a guess wearing a real number. So the
sample was widened: **every coding-agent trace on this account for 31 days** —
16,980 of 16,983, 11 Aug to 11 Sep, **$31,918.86**. Carry ratio holds at
**406:1**, and cache reads are **98.3%** of all input tokens. Five of the six
signal families survive. The headline does not.

### 11.1 Spend is a power law, and one session was 42% of the month

| | sessions | share of spend |
|---|---:|---:|
| top 1% | 2 | **48.7%** |
| top 5% | 12 | 62.9% |
| top 10% | 24 | 73.4% |
| top 25% | 60 | 87.3% |

Median session: **$25.31**. Largest single session: **$13,529.07** — 42% of the
month, on its own. Median turn: $0.20. Largest turn: $85.65.

### 11.2 The dominant pattern is sessions that never end

| session wall-clock | sessions | share of spend |
|---|---:|---:|
| under 1h | 96 (40.0%) | 2.6% |
| 1–8h | 93 (38.8%) | 22.5% |
| 8–24h | 28 (11.7%) | 17.5% |
| 1–3 days | 13 (5.4%) | 5.9% |
| **over 3 days** | **10 (4.2%)** | **51.5%** |

Ten sessions, four percent of the population, hold more than half the spend.

The $13,529 session ran from 28 Aug to 10 Sep — **fourteen days**, 6,161 turns,
637 errors, seven models. Day by day it cost between $298 and $1,699. **No single
day looks alarming. Only the total does.** That is precisely why a human never
catches it, and it is the strongest argument in this document for background
detection.

It also breaks the obvious detector. Its context peaked at **985.8k** on day 3 —
against a 1M window — and then *fell back to about 560k and stayed there* for
eleven more days as compaction did its job. A context-growth alarm would have
fired once, been satisfied, and gone quiet while the session spent another
$11,000. **`context.unbounded_growth` is necessary and nowhere near sufficient.**

### 11.3 The single most actionable number in the whole analysis

A plain per-session cumulative spend threshold:

| threshold | fires on | those sessions hold | spend accrued *past* the line |
|---|---:|---:|---:|
| $50 | 87 (36.3%) | 92.9% | $25,299 |
| $100 | 48 (20.0%) | 83.9% | $21,996 |
| **$250** | **20 (8.3%)** | **70.6%** | **$17,530** |
| $500 | 8 (3.3%) | 57.7% | $14,432 |
| $1,000 | 2 (0.8%) | 46.0% | $12,696 |

At $250 it fires twenty times in a month — roughly five a week, entirely
reasonable — and $17,530 of this month's spend happened after those sessions
crossed it. No modelling, no inference, no new capture. A running total and a
number.

### 11.4 Peak context predicts cost better than anything else measured

| peak context | sessions | share of spend |
|---|---:|---:|
| over 900k | 7 | **46.1%** |
| 700–900k | 13 | 14.0% |
| 500–700k | 38 | 24.0% |
| 300–500k | 58 | 11.6% |
| under 300k | 124 | 4.3% |

Half the population never passes 300k and accounts for one twenty-third of the
bill. Three sessions hit `prompt is too long: 1,000,497 tokens > 1,000,000` —
they ran the window to its literal ceiling.

### 11.5 The "turn" is the wrong unit, and it is hiding the real one

The trace population is sharply bimodal:

| | n | median duration | median output | median cost | share of spend |
|---|---:|---:|---:|---:|---:|
| heavy (>60s or >5k output) | 3,318 | — | — | — | **92.6%** |
| light | 13,662 | 4s | 77 tokens | $0.07 | 7.4% |

Four fifths of what the product calls a trace is a sub-agent call, a permission
classifier or a one-line reply. **The entire month reduces to 2,013 heavy Opus
turns costing $19,811 — 62% of everything.** Any per-turn average computed over
the whole population is meaningless, and any UI that lists "turns" without
separating these is showing noise at 80% density.

### 11.6 A warning: do not build a signal on the trace error field

11% of turns carry an error, and they hold 64.6% of spend — which looks
spectacular and means almost nothing:

| | median duration | median output | median cache-read |
|---|---:|---:|---:|
| errored | 528s | 37,950 | 12.35M |
| clean | 4s | 77 | 0.21M |

The error field marks *long agentic turns*, because a multi-minute turn almost
always contains at least one failing command somewhere in it. It is confounded
with turn size. A detector built on it would measure length and call it waste.

That said, the composition is worth reading on its own terms: **1,064 shell
command failures and 614 worktree-guard refusals** in a month. Those are turns
where our own local tooling blocked the agent. The guard refusal is not
hypothetical — it blocked every `git` call in this very session until the binary
was invoked by absolute path.

### 11.7 Cache rebuild after an idle gap is real, and it is 11.6×

Mean cache **write** on a turn, bucketed by the gap before it:

| gap before the turn | turns | mean cache write |
|---|---:|---:|
| under 1 min | 6,230 | 25.7k |
| 1–5 min | 2,149 | 98.9k |
| 5–60 min | 2,405 | 96.7k |
| **over 60 min** | **137** | **298.7k** |

The cache expires, so walking away and coming back means paying to rebuild the
prefix. `context.idle_hold` now has a price.

### 11.8 Nobody is watching, and the spend does not care

Spend by hour of day is nearly flat: low of $739 at 07:00 UTC, high of $1,884 at
12:00. Roughly **35% of the month's spend lands between midnight and 08:00 UTC**.
These agents run around the clock. A recommendation that only reaches a human
during working hours misses a third of the problem, which is the argument for
delivering into the agent's own context rather than a dashboard.

### 11.9 The verification tier would already have something to report

| week | spend | carry ratio | Opus share |
|---|---:|---:|---:|
| 10 Aug | $4,667 | 410:1 | 43.4% |
| 17 Aug | $6,940 | 425:1 | 53.1% |
| 24 Aug | $7,083 | 476:1 | 83.2% |
| 31 Aug | $9,204 | 392:1 | 70.2% |
| 7 Sep | $4,025 | **333:1** | 64.4% |

Opus share fell from 83.2% to 64.4% and carry ratio from 476:1 to 333:1 across
the last three weeks, as Sonnet and Fable took a growing share. The behaviour
change is already visible in the data. Nothing in the product says so, and
nobody would know the protocol worked without running this analysis by hand —
which is the whole thesis.

### 11.10 What changes in the design

- **Add a family, `spend.*`, and lead with it.** Cumulative session spend,
  session lifetime, and burn rate per hour. On this month it beats every
  behavioural signal for both simplicity and yield.
- **`context.unbounded_growth` is demoted.** Keep it, but peak context is better
  used as a *cohort* marker than an alarm, and it is blind to the plateau case
  that cost the most.
- **Separate heavy turns from light calls everywhere** — in signals, in
  aggregates and in the UI.
- **Do not use the trace error field as a waste signal.** Use tool-span
  `success` instead, which is not confounded with turn length.
- **Add local tooling friction as a cost centre.** 1,678 turns hit a shell
  failure or a local guard this month.
- **Per-turn cost does not compound; sessions do.** Turn 1 averages $5.70 and
  turn 128+ averages $1.30. The compounding is in session length and count.

### 11.11 Still outstanding

This is still **one person, one project**. Cross-project and per-teammate
comparison needs an organization API key — the device login carries a project
key, and `projects list` refuses it with *"This endpoint needs an organization
API key"*. Given one, the same two scripts run unchanged
(`analyse.mjs`, `analyse2.mjs`) and would answer the question this pass cannot:
which of the eleven patterns above are LangWatch-wide, and which are one
person's habits.
