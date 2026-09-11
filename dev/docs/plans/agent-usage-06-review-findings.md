# Part 6 — What four independent reviews found wrong

**Status:** corrections register. Read this **before** acting on Parts 1–5.
**Reviewers:** Fable 5.1, Sonnet 5, Codex Sol (`gpt-5.6-sol`), Codex Astra
(`gpt-6-astra`) — same brief, run independently, 2026-09-11.

Parts 1–5 are evidence-led but several conclusions do not survive review. Four of
them **invert**. Nothing in Parts 1–5 should be specced until this register is
worked through; where a claim below is marked WRONG, the original text is still
in place and should be read as retracted.

---

## S1 — Errors that invert a conclusion

### 1. WRONG: the instruction floor is ~25% of reads, not 2.8%

Parts 2 §4b and 4 §5 compute `16,980 turns × 70,151 = 1.19B = 2.8%` of 42.75B
cache reads, and conclude the static prefix is "real money, and not the dominant
lever".

**The prefix is re-read on every model call, not every turn.** Observed: 8,614
model calls against 312 user prompts — **27.6 calls per prompt**. Independently
bounding it: 42.75B ÷ median context 278,868 implies **~153,000 model calls**, so
the prefix is `70,151 × 153,000 ≈ 10.8B ≈ **25% of cache reads**`.

This is the third instance of the same error class in this document set —
counting an injection once when it is read many times. It was corrected for tool
output (§26.3×) and for metrics (Part 4 §3); here it was made in the opposite
direction and made the biggest lever look small. **Trimming `CLAUDE.md` is
plausibly the single highest-yield action available**, not a footnote.

### 2. WRONG: the output-filter counterfactual double-counts an already-adopted tool

Part 5 §§1–3 prices a shell-output filter as "the largest single measured one",
on 2.73M injected tool tokens.

**This account already runs that filter** — it is mandated in the user's global
instructions and installed as a command-rewriting hook. So the 2.73M is
**post-filter**, and applying a 50–90% reduction to it counts the same saving
twice. Part 5 §1 says "0 of 10,463 Bash commands were routed through it" while
§3 says the account "routes many commands through the filter": the same document
contradicts itself about whether the practice is adopted.

Worse, and unnoticed across five parts: **that hook is the cause of the 614
`local_guard_refusal` errors in Part 1 §5** — it rewrites `git` into a wrapped
form the worktree guard cannot verify. Part 5's flagship practice generates
Part 1's second-largest error class. No part connects them.

Scale check: 71.87M carried reads at the ≈$0.50/M cache-read rate implied by the
$19.44 turn is **≈$36 across three sessions**; a 60% cut is **≈$16**. Against
$31,918. It would barely clear Part 2's own "a finding worth $3 a week never
reaches a human" bar.

### 3. UNRESOLVED: is the $31,918 money, or a list-price valuation?

Part 3 asserts gateway enforcement is "harness-independent". It is
**API-key-independent**, which is not the same thing. Claude Code on a
subscription authenticates by OAuth and cannot be routed through a virtual-key
gateway, so the stop cannot reach the traffic that produced the evidence.

The ideation mentions billed-versus-bundled cost and never resolves it. **If this
spend is bundled subscription usage priced at list, then "$17,530 recoverable" is
not money at all**, and the economic argument of Parts 3 and 5 changes shape.
Resolve this before anything is priced.

### 4. WRONG: "Bash fails 5.3%, Edit fails 0%" compares exit codes to a tool that cannot fail

Part 1 §2, Part 2 §D, Part 3 §3.2 and Part 5 all rest on this.

A non-zero exit is not a failure. `grep` with no match, a **deliberately failing
test written red-first** — which this repository's own workflow mandates — and a
typecheck reporting errors all exit non-zero and are all the *wanted* result.
Meanwhile `Edit` cannot return a non-zero exit at all, so 0.0% is definitional,
not evidence of safety.

The actual claim — that `sed -i`-style shell mutation fails more than an edit
tool — **is never measured**. `tool.failure_storm`,
`behaviour.failure_concentration` and the shell-mutation safety argument all
inherit this and must be re-derived from comparable operations.

---

## S2 — Claims that overstate the evidence

| # | claim | correction |
|---|---|---|
| 5 | 26.3× carry amplification | An **estimated exposure model**, not a measurement. Nothing proves verbatim survival across calls; harness pruning, truncation and partial compaction are unmodelled; it counts turns where billing is per call. **97% of it is one session.** Publish the algorithm and the per-session range (5.8× / 6.1× / 29.1×), never the pooled figure. |
| 6 | "$17,530 accrued past the $250 line" | Measures **exposed** spend, not recoverable waste — the work still has to be done, and a restart re-pays a floor. Remove the single $13,529 session and it is **$4,251 over 19 sessions, $224 each**. The remedy is never priced. |
| 7 | "~70k static prefix" | Survives one challenge — 94.5% of sessions start in 50–90k, and excluding the 11 possible resumes the median moves only 70,151 → **69,197**. But first prompts were never measured as short, local file bytes are not tokens loaded (inclusion rules, conditional skill bodies, tokenizer), and a 4,864 minimum defeats "every session". **Upper-bound proxy** until controlled empty sessions measure it per harness. |
| 8 | §11.9 "the behaviour change is already visible" offered as verification | **Backwards in time.** The handoff protocol landed 11 September; the carry-ratio improvement runs 24 Aug → 7 Sep. It cannot be evidence for something that had not happened. Boundary weeks are also partial. |
| 9 | classifier tax "10% of a turn" | One turn, reused as a catalogue price. The month bounds **all** light traces at 7.4% of spend; classifiers are a subset. State **≤7%, likely 2–3%**. |
| 10 | "skills fire on 0.46% of tool calls" | Wrong denominator — dominated by Bash. Per *prompt* it is plausibly ~20%. And only the **index (~2.3k tokens, 3% of floor)** is always paid; bodies load on invocation. The "38,500 words paid every turn" framing conflates the two. |
| 11 | shell mutation 16.7% | One trace. It becomes "**17% of commands last week**" in Part 3's sample brief — the caveat did not survive one file. |

---

## S3 — Internal contradictions to fix

- **`b20f71f1` has two histories**: 188 prompts / 5 compactions (ideation §3) versus 103 turns / 1 compaction (Part 5 §2). Amplification scales with turns-between-compactions, so with five it roughly halves. The observation window is unstated — one reading was capped at 20,000 events.
- **Context floor stated twice**: 32,150 (ideation §4.A) versus ~70k (Part 2 §4b, Part 4 §5).
- **Top-1% is three sessions**, not two (`ceil(240 × 0.01) = 3`). It reconciles, but the rounding is never stated, which is why the $1,000 row (46.0%) appears to conflict with §11.1 (48.7%).
- **Bash "10,463 of ~13,900"** — the table sums to 13,613.
- **"The three parts"** heading now introduces five.
- **"1,678 turns hit a shell failure or a local guard"** — those are error *occurrences* and may overlap within a turn.
- **"No single day looks alarming"** is refuted by the row above it: $1,699 in a day is 67× the median session, and a $500/day burn line fires on day one. The argument for background detection is made with a case a trivial detector catches.
- **Part 4's rollup** asserts three things that cannot all hold: increment on immutable events *because their dimensions are final*; key the rollup on repository/branch/session-shape; repository and branch arrive late from a memo. Needs an explicit correction/restatement path.
- **Part 3 treats `PreToolUse` and "between turns" as the same.** `PreToolUse` is mid-turn; the between-turns boundary is `UserPromptSubmit`.
- **Part 2 §7's issue key is repository-wide**, omitting the person/visibility boundary the ideation's own privacy section requires.

---

## S4 — Missing, and at least one of these is bigger than anything in Parts 1–5

1. **Long-context premium pricing.** If per-token rates step up above a context threshold on the models in use, then sitting at 560k costs materially more per token — a lever larger than every practice in Part 5, and absent from all six documents. **Check this first.**
2. **Carry ratio rewards verbosity.** Completion tokens include thinking. A model or budget that thinks more lowers the ratio with no behavioural change, so it is not safe as a headline KPI without normalisation.
3. **The idle-rebuild table is confounded.** 1–5 min (98.9k) and 5–60 min (96.7k) are identical; the only step is under-1-minute versus everything else — which is intra-turn tool-loop calls versus a new prompt, not cache expiry. At ~137 turns it is worth roughly $16/month. `context.idle_hold` is not worth a detector.
4. **Per-tenant calibration** of every threshold, as a percentile of that tenant's own trailing distribution. "Warn at half the line" is meaningless without it.
5. **Verification has no control group**, and savings overlap — filtering, shortening sessions and trimming instructions cannot each claim the same avoided reads.
6. **Most tenants will see nothing.** Half of the 240 sessions are under 300k peak and 4.3% of spend.
7. **Cost per landed change is not "the only fair ranking".** It scores research, review and failed experiments as zero value and rewards splitting work into tiny commits.
8. **Session identity across resume, fork, subagent and harness restart**, or fleet spend is double-counted.
9. **Recommendation exposure logs and versioning** — verification is impossible without knowing who received which advice, at which version.

---

## S5 — Two principles this set violates

### Report model and effort switches explicitly

Whenever work moves between models or reasoning-effort levels — in a session, in
a lane fan-out, or inside the product's own recommendations — say so plainly and
in the same place as the result. A cost or quality difference that coincides with
an unreported model switch is uninterpretable, which is exactly the confound that
made §11.9 above unusable as verification.

### Do not ship folklore

The sharpest risk across all five parts. Almost every threshold and practice here
derives from **one person, one project, one month**: `$250`, the three-day
lifetime, the `/loop` cadence, the output filter, the 70k floor,
`CLAUDE.md` at 112 KB. Presented as general, they are folklore with a number
attached.

The shape that avoids it:

- **A general, agnostic core.** Detectors express relationships — carry ratio,
  spend against a tenant's own distribution, failure concentration — never
  absolute constants. Every threshold is a percentile of that tenant's trailing
  data, with a documented derivation and an override.
- **Explicit per-harness knowledge, labelled as such.** What a turn is, which
  events exist, whether a hook can reach the model, whether compaction is
  automatic, what a non-zero exit means, whether traffic can be routed through a
  gateway — all differ per harness and must live in a declared per-harness table,
  not be assumed from Claude Code. Finding 4 above is exactly what happens when
  harness-specific semantics are read as universal.
- **Sample size and provenance on every published number**, so a reader can tell
  a measured distribution from one person's habit.

---

## What all four reviewers agreed on structurally

Five parts should be three: **fidelity**, **analysis and surfacing (including
metrics)**, **delivery**. Part 5 is Part 2's Finding with a field renamed, and
Part 4 §5 restates Part 2 §4b.

Two of four would add the same thing: a **shadow-mode evaluation phase** —
versioned detectors, per-tenant calibration, exact session and turn attribution,
matched controls, and measured effects on spend, completion, quality *and*
rework — before any hook advice or enforcement ships. Without it the product can
honestly detect expensive sessions and cannot honestly claim waste or savings.
