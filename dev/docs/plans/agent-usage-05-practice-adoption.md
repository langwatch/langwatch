# Part 5 — Practice adoption and counterfactual savings

**Status:** design input. No ADR, no spec yet.
**Part of:** [ideation](agent-usage-advisor-ideation.md) ·
[1 trace fidelity](agent-usage-01-trace-fidelity.md) ·
[2 signals and surfacing](agent-usage-02-signals-and-surfacing.md) ·
[3 the hook advisor](agent-usage-03-cli-hook-advisor.md) ·
[4 metrics and context analysis](agent-usage-04-metrics-and-context-analysis.md)

Parts 1–4 say what happened and what it cost. This part says **what a team has
not adopted yet, and what adopting it would be worth** — in money, computed from
their own data rather than from a vendor's claim.

---

## 1. The shape

A **practice** is a known-good thing a team either does or does not do. Each one
has a detector, a measured gap, and a price:

```
practice        rtk-bash-filter
detected        no  (0 of 10,463 Bash commands were routed through it)
gap             54.09M carried read-tokens attributable to raw Bash output
estimate        a 60% output reduction saves 32.46M read-tokens/month
confidence      measured on this account, not claimed by the vendor
verify          re-measure 14 days after adoption
```

That last line is what separates this from a listicle. Part 2's verification pass
already exists to close the loop: a recommendation that does not move the metric
gets retired rather than repeated.

## 2. The mechanic that makes this work: carried cost, not injected cost

The reason practice recommendations are worth real money is that **context is
re-read**. A token injected at turn *i* is read again on every subsequent turn
until a compaction drops it. So the true cost of a tool result is not its size —
it is its size multiplied by how long it survives.

Measured on three real sessions:

| session | turns | compactions | tool output injected | carried re-reads | amplification |
|---|---:|---:|---:|---:|---:|
| `b20f71f1` | 103 | 1 | 2.40M | 69.92M | **29.1×** |
| `0a5117b3` | 9 | 0 | 0.21M | 1.20M | 5.8× |
| `fda27b80` | 12 | 0 | 0.12M | 0.74M | 6.1× |
| **total** | | | **2.73M** | **71.87M** | **26.3×** |

Bash accounts for **54.09M of the 71.87M — 75%**.

This corrects an earlier reading in Part 2. Measured by direct injection, tool
output looked negligible: 2.73M tokens against billions of cache reads. Measured
by what it *causes*, it is 26× larger. It is still not the dominant term — the
static prefix and conversation history are bigger — but the naive measure
understates it by more than an order of magnitude, and the longer the session the
worse the understatement gets.

**Every counterfactual in this part is computed on carried tokens.** Anything
computed on injected tokens will under-sell the saving by roughly 26×.

## 3. The worked example: an output filter

A shell-output filter (RTK is the one in use here) reduces what a command returns
before it enters context. Applying the measured carry model:

| output reduction | carried read-tokens saved | share of all tool-caused reads |
|---:|---:|---:|
| 50% | 27.05M | 38% |
| 60% | 32.46M | 45% |
| 75% | 40.57M | 56% |
| 90% | 48.68M | 68% |

The product multiplies those tokens by the tenant's own blended cache-read price
rather than a headline rate, so the number a customer sees is theirs.

**Detection is straightforward and already available.** Adoption shows up in the
command text: a routed command begins with the wrapper's name. Part 1 §7 proposes
lifting a bounded classification of the command at ingest, and "was this routed
through a known filter" is one boolean on that classification. It also catches
partial adoption, which is the common case — this account routes many commands
through the filter and then calls `/usr/bin/git` directly to get around a hook
conflict, which is exactly the kind of gap a report should surface.

## 4. The practice catalogue

Each entry is data, not code: a detector, a measurement, a remedy.

| practice | detector | what the gap costs |
|---|---|---|
| **output filtering** | command prefix on Bash calls | §3 — the largest single measured one |
| **edit tool over shell mutation** | `sed -i`/`python`/heredoc classification | higher failure rate (5.3% vs 0.0%) and it blinds our own line-count telemetry (Part 2 §3) |
| **tool allowlist** | permission-classifier calls per turn | 10% of the most expensive turn observed |
| **skills** | `Skill` invocations vs skills present | fires on **0.46%** of tool calls; unused skills are paid for on every turn |
| **sub-agents** | `Agent` calls vs long single-threaded turns | a fleet that never spawns carries one context instead of several small ones |
| **linters and formatters** | is one configured, and do sessions run it before committing | correlate with repair turns — see below |
| **handoff protocol** | session lifetime and resume depth | sessions over 3 days were 51.5% of spend |
| **model routing** | premium model on mechanical work | 86% of one PR's cost was a single model |
| **instruction size** | locally measured `CLAUDE.md` bytes (Part 3) | ~40% of a ~70k floor re-read every turn |

**Linters deserve a note**, because the useful claim is not "you should lint" —
every team knows that. It is the correlation only a platform can compute:
*sessions in this repository that ran the linter before committing had N% fewer
repair turns.* That requires the command classification from Part 1 and the
rework measure that Part 1 §8 says is missing. Until rework exists, this practice
is detectable but not priceable, and it should say so rather than guess.

## 5. When a new tool appears

The catalogue being data is the point. When another filter, linter or harness
arrives, adding it is an entry with a detector and a reduction factor — and every
customer immediately gets a costed answer to "would this be worth it for us",
computed on their own traffic.

Two things make that genuinely defensible rather than a feature:

- **The before-and-after.** Once a team adopts something, Part 2's verification
  measures what actually changed. After enough adoptions, the reduction factor
  stops being the vendor's claim and becomes a measured distribution — *"teams
  who adopted this saw a median 54% reduction, p10 31%, p90 78%"*.
- **Cross-org comparison.** Only a platform holding many organisations can say
  what adoption is worth in general. That is the same opt-in, anonymised
  benchmark surface the ideation proposes, applied to practices instead of
  outcomes.

## 6. Honesty rules

These are what keep the feature from becoming a recommendation-shilling engine,
and they are not optional.

- **Never quote a vendor's number as ours.** A claimed reduction is labelled
  claimed until we have measured it on real traffic.
- **Compute on the customer's own data.** A recommendation priced on someone
  else's sessions is marketing.
- **Verify, then keep or retire.** A practice whose adoption does not move the
  metric leaves the catalogue.
- **Rank by measured recoverable spend**, and never show a recommendation worth
  less than it costs to read.
- **Be neutral about third-party tools.** Detect and price categories — output
  filtering, linting — and name specific tools as instances, including ones we
  have no relationship with. The moment the catalogue becomes a partner list, the
  numbers stop being believed.
- **Say when something is detectable but not priceable.** The linter correlation
  above is the current example.

## 7. Risks

- **Nagging a team about practices they have deliberately rejected.** A dismissal
  must stick, per practice per repository, and feed the threshold.
- **Recommending a tool that makes the agent worse.** Token reduction is not the
  only axis; a filter that hides output the agent needed causes rework. This is
  precisely why §6 insists on measuring after adoption rather than at it — the
  verification must watch rework and failure rate, not only spend.
- **Over-claiming from a thin sample.** The amplification figures in §2 come from
  three sessions. They are a method demonstration, not a published constant, and
  the catalogue should carry sample sizes.

## 8. Done when

- A practice catalogue exists as data, with a detector and a measurement per
  entry.
- Adoption is detected from the command classification lifted in Part 1.
- Every recommendation is priced on carried tokens, on the customer's own
  traffic, at the customer's own rate.
- Adoption is verified afterwards against spend **and** against rework.
- A new entry can be added without shipping code.
