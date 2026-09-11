# Part 8 — The frustration signal: measured, and it is not what we expected

**Status:** measured, from platform data. Design input.
**Part of:** [ideation](agent-usage-advisor-ideation.md) ·
[2 signals and surfacing](agent-usage-02-signals-and-surfacing.md) ·
[6 review findings](agent-usage-06-review-findings.md) ·
[7 team probe](agent-usage-07-team-probe.md)

The premise: use profanity in user prompts as a proxy for frustration, and
correlate it with expensive sessions. The hypothesis attached to it: frustration
rises with context size.

**The hypothesis is wrong as stated, and the corrected version is stronger.**
Frustration rises with *position in a session*, not with context size. The
context-size correlation is an artefact of survivorship, and it points the wrong
way once the artefact is removed.

---

## 1. The data is already there

`langwatch trace export --origin coding_agent` carries `input.value` — the user's
own prompt text — on turn-initiating traces, alongside `context_size_tokens`,
`total_cost`, `thread_id` and the timestamp. Nothing needs to be built to measure
this, and nothing needs to be read off a developer's laptop.

**5,467 prompts with text across 270 sessions, 2026-07-12 to 2026-09-11.**
Baseline profanity rate **1.52%** (83 prompts). Strong profanity 1.1%.

One caveat that shapes everything below: 83 events is a small sample. At this
base rate a band of 500 prompts expects ~7 events, so a single message moves a
cell by 0.2 points. Most fine-grained cuts are noise, and the write-up says so
each time rather than reporting them as findings.

## 2. What the naive cut says, and why it is wrong

Profanity by context size at the time of the prompt:

| context | prompts | sworn | lift |
|---|---|---|---|
| 0–100k | 527 | 3.0% | 2.02× |
| 100–200k | 915 | 1.9% | 1.22× |
| 200–300k | 1,069 | 1.7% | 1.11× |
| 300–500k | 1,752 | 1.3% | 0.83× |
| >500k | 668 | 0.3% | 0.20× |

Read naively: **people swear less as context grows**, monotonically, by 10×.
That would be a real finding if the bands compared like with like. They do not.

**The survivorship confound, which is fatal:**

| session peak context | sessions | median prompts per session |
|---|---|---|
| under 200k | 109 | **2** |
| 200–500k | 99 | 9 |
| 500k and up | 62 | **28** |

A prompt observed at low context is overwhelmingly one of the *first two prompts
of a session that went nowhere*. A prompt at high context is the twentieth prompt
of a session someone kept alive. The context bands are a proxy for "how far into
a session am I", crossed with "did this session survive" — and the second term
dominates. Sessions that reach 500k are the ones going well enough to keep.

Two further confounds were checked and are not the explanation:

- **Prompt length.** Median words per prompt is non-monotonic (17 → 39 → 21
  across the bands), so it cannot produce a monotonic fall. Normalising to hits
  per 1,000 words gives the same direction, more steeply.
- **Acronym false positives in the "shouting" detector.** `\b[A-Z]{4,}\b`
  matches `CLAUDE`, `JSON`, `ADR`, `RTK`, `LANGWATCH`, `TODO`. Before filtering,
  ALL-CAPS looked like a frustration signal rising 2.09× with context. After
  removing a technical-acronym list it tracks prompt length instead and says
  nothing. **This detector would have shipped as a finding.**

## 3. The controlled comparison, which says the opposite

Compare within each session — first third of its prompts against the last third,
so session identity, task, person and harness are all held constant. 141 sessions
with at least six prompts, 1,659 prompts in each group.

| signal | first third | last third | ratio | p |
|---|---|---|---|---|
| profanity | 17 / 1,659 = **1.02%** | 36 / 1,659 = **2.17%** | 2.12× | **0.0085** |
| "I already told you" | 4 / 1,659 = **0.24%** | 15 / 1,659 = **0.90%** | 3.75× | **0.0114** |

Both significant, profanity at the 1% level. Both rise **monotonically across
thirds** rather than jumping at the end:

```
  profanity   1.02%  →  1.15%  →  2.17%
  told-you    0.24%  →  0.48%  →  0.90%
```

Two independent lexicons — one profanity, one aimed-at-the-agent repetition
("as I said", "I already", "you keep", "that's not what") — moving together by
2–4× is what makes this credible on 83 events. Either alone would not be.

**The control that settles it.** Take only sessions that reached 500k, and split
their prompts by context instead of position:

| | under 300k | 300k and up |
|---|---|---|
| profanity | **2.09%** (n=1,862) | 1.14% (n=2,021) |
| told-you | **0.86%** | 0.45% |

Inside one cohort, the context correlation *reverses*. Position survives the
control; context does not. **Elapsed turns are the driver, not window size.**

There is a mechanism that fits: in a long session, low context late on means
*just compacted*. That is tested directly in §3b rather than left as a guess.

## 3b. The compaction event, tested directly — and the polarity splits

Keying on the 511 observed context resets rather than inferring from context.
The control is tight: the **5 prompts immediately after** each reset against the
**5 prompts immediately before the same reset** — same session, same task, a few
minutes apart, so session position is held as flat as it can be held.

| signal | 5 before | 5 after | ratio | p |
|---|---|---|---|---|
| profanity | 59 / 2,484 = **2.38%** | 30 / 2,443 = **1.23%** | **0.52×** | 0.0025 |
| "I already told you" | 14 / 2,484 = **0.56%** | 35 / 2,443 = **1.43%** | **2.54×** | 0.0021 |
| ALL CAPS (acronyms removed) | 1,063 / 2,484 = 42.8% | 1,338 / 2,443 = **54.8%** | 1.28× | <0.0001 |

**The two signals point opposite ways across the same event, and that is the
finding.** Profanity is a *leading* indicator — it peaks in the bloated context
*before* the reset, and falls by half afterwards. Aimed repetition is a
*lagging* one, spiking 2.5× after. Read together:

> Frustration accumulates in a long context → the session is compacted → the
> agent has lost things it was told → the person restates them.

That is a sequence, not a correlation, and each half is separately significant.
It also explains §3's reversal exactly: post-compaction prompts are low-context
*and* carry the lagging signal, which is what dragged the low-context band up.

**Do not read the caps row as shouting.** A 42.8% baseline means the detector is
dominated by technical vocabulary even after the acronym list — this corpus
capitalises file names, constants and ADR numbers. The most likely reading of
the rise is that people **re-name the entities the agent just lost**, which is
the same mechanism by a different route, but it is not emotion and must not be
labelled as such. As a *context-reconstruction* signal it may be more useful than
as a frustration one: it measures how much re-establishing a compaction cost.

**Clustering.** Consecutive sworn prompts in a session sit a median **61.6
minutes** apart. If profanity were independent at the 1.52% base rate with a
median 5.4-minute gap between prompts, the expected median gap would be roughly
**246 minutes**. Observed clustering is about **4× tighter than chance** — so
swearing does arrive in bursts, and the bursts sit before compactions.

The distance-from-reset profile (2.44% at 0–2 prompts after, 1.30% at 3–5, 2.06%
at 6–10, 1.07% at 11+) is built on 20, 7, 13 and 14 events and is **noise**; it
is recorded only so it is not mistaken for a decay curve later.

## 4. What did not replicate

Reported so they are not re-derived later as discoveries:

- **Time of day: nothing.** Four six-hour blocks, all p > 0.14 (night 1.00%,
  morning 2.02%, afternoon 1.68%, evening 1.41%). The hourly view appeared to
  show an 08:00 spike at 4.1% — that is **7 events**. 83 events cannot support
  24 buckets and should never have been split that way.
- **Weekday versus weekend: nothing.** 1.55% versus 1.30%, p = 0.87.
- **Week to week: not established.** Three of six weeks flag individually
  (W34 2.27%, W36 0.75%, W37 2.56%), but six weeks were tested with no
  correction; at Bonferroni α = 0.0083 none survive.
- **"I've been swearing a lot the last couple of weeks": not supported.**
  Last two weeks 1.44% versus 1.57% earlier, p = 0.69.

That last one is the most interesting negative in the set, and it argues *for*
the feature rather than against it: **self-reported frustration did not match
measured frustration.** The person most confident about their own recent
frustration was wrong about when it happened. A product that asks people how
their sessions went will get that same wrong answer.

## 5. What this means for the product

**Profanity is a leading indicator of a compaction, and that is the product.**
Part 6 §S6 argues the useful intervention is a checkpoint prompt at a context
threshold rather than a spend warning. §3b sharpens it: swearing rises *before* a
reset and halves after, so it is not a lagging complaint about a session that has
already gone wrong — it arrives while there is still something to do about it.
The trigger worth building is a composite of *turns into the session*, *context
carried*, and *a leading-signal burst in the last few prompts*. "Twenty-two turns
in, 340k carried, two frustration signals in the last five prompts — checkpoint
now" is a far better reason to interrupt someone than a dollar figure.

**Use the two signals for different jobs.** They are not interchangeable:

| signal | timing | what it is good for |
|---|---|---|
| profanity | leads a reset | *triggering* a checkpoint suggestion before the bloat bites |
| aimed repetition | lags a reset | *measuring* what a compaction cost — how much had to be re-said |
| caps / entity renaming | lags a reset | same, and probably the better instrument for it |

The second row is the one that closes the loop on Part 6 §S6, which prices
checkpointing at ~42% of read tokens but explicitly leaves **re-derivation
unpriced**. Aimed repetition after a reset is a direct, cheap measurement of
exactly that cost — the missing term in the checkpoint counterfactual. Measuring
it should come before shipping any checkpoint advice, because it is the number
that decides whether a 42% token saving is real or is spent again immediately.

**Calibrate on the person, never on a constant.** The baseline here is 1.52%.
Someone else's is 0% and someone else's is 15% — plenty of people swear as
register rather than as sentiment, and British English in particular uses mild
profanity as punctuation. An absolute threshold measures dialect. The signal is
**deviation from that person's own trailing baseline**, and for a person whose
baseline is zero the profanity lexicon contributes nothing and the aimed-repetition
lexicon carries the whole signal. This is Part 6 §S5's folklore rule applied to
the letter.

**Composite, not a single lexicon.** Profanity alone is register. The two signals
that survived here should both be inputs, with the aimed-repetition one weighted
higher: it is the one that means "the agent is not listening", which is the thing
the product could actually act on.

**Ship the acronym filter with the detector.** The ALL-CAPS finding was a false
positive that looked like the strongest result in the set until the filter went
in. Any shouting detector needs a technical-vocabulary exclusion list, and that
list is per-corpus.

## 6. The part that needs a decision before anything is built

Every other signal in Parts 1–7 is derived from token counts and timings. **This
one reads what the person wrote.** That is a different category and should be
treated as one:

- **It needs explicit opt-in**, separately from trace ingestion, and it must be
  visible in the product that it is on.
- **Store the score, not the text, and not the matched words.** The computation
  can happen at ingest; nothing needs to persist a lexicon hit, and persisting
  one creates a record of who swore at what.
- **It must not become a management surface.** A per-developer frustration
  ranking visible to their manager is a different product from a per-developer
  hint that a session has gone sour, and the second one stops being useful the
  moment it can be read as the first. Aggregate across a team or show it only to
  the person it is about.
- **Personal workspaces stay out of it** — they are isolated on purpose, and this
  is precisely the kind of signal that isolation exists for.

None of that is an argument against building it. It is an argument for deciding
the exposure model first, because it is much harder to retract than a chart.

## 7. Done when

- A frustration score is computed at ingest from `input.value` and stored as a
  number, with no lexicon hit or matched text persisted anywhere.
- The score is a deviation from the tenant's and person's own trailing baseline,
  never an absolute rate.
- Both lexicons ship, aimed-repetition weighted above profanity, with a
  technical-acronym exclusion list on any caps detector.
- It is opt-in, visible, and scoped so it cannot be read as a per-person
  performance metric.
- The positional finding is re-tested on other people's data via
  [Part 7](agent-usage-07-team-probe.md) before any threshold is shipped —
  **one person, 83 events, one harness**.
