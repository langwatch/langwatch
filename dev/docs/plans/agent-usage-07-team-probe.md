# Part 7 — The team probe: does any of this generalise?

**Status:** ready to send.
**Purpose:** Part 6 §S5 says the sharpest risk in this whole set is folklore —
one person, one project, one month, presented as general. This part is the test.
**Artifacts:** [`dev/scripts/agent-usage-probe.mjs`](../../scripts/agent-usage-probe.mjs) ·
baseline card below.

---

## 1. What this is for

Every threshold in Parts 1–5 comes from a single account. Some of them will be
properties of coding agents; some will be properties of Alex. **Nothing in this
document set should become a product default until we know which is which**, and
the only way to find out is to run the identical measurement on other people's
data and see what survives.

The bar: a finding that reproduces on **four of four** workspaces is a candidate
for a general detector. One that appears on **one of four** is that person's
habit, and belongs in a per-harness or per-tenant table, never in a default.

**The four are four colleagues. Alex's workspace is not one of them** — it is
the baseline the four are tested against, and a claim cannot count its own
source as evidence for itself. If fewer than four people run the probe, the
denominator is however many actually did, fixed in writing **before** any card
is opened, and the strength of the claim drops with it: three of three is a
weaker statement than four of four, not the same one.

## 2. Why a script and not just a prompt

If three people ask their agent to "compute the carry ratio and session
concentration", we get three definitions of both and the comparison means
nothing. `agent-usage-probe.mjs` defines each number exactly once. Everyone runs
the same code over their own export.

The corollary matters just as much: **the teammate's agent must not recompute
anything by hand, invent thresholds, or substitute its own metric.** The prompt
below says so explicitly.

## 3. What leaves their machine

Two different things, and conflating them would be a lie by omission:

**The card contains no text.** Counts, sums and percentiles only. Project
identity is reduced to a salt-free SHA-256 prefix so we can tell two workspaces
apart without naming either. Nothing quotable, no matched words, no paths. The
card is the only thing that comes back.

**The export on their disk does contain text.** The `--include-spans` flag is
deliberately absent, which drops the span bodies — but each *trace* still
carries the turn's own prompt in `input.value`, and the probe reads exactly that
to score the frustration signal (`agent-usage-probe.mjs`, the `text:` field of
the trace mapper). So `my-agent-traces.jsonl` is a file of their own prompts,
sitting in `~/agent-usage`. It never leaves the machine, nothing uploads it, and
they can delete it the moment the card is written — but they should be told it
exists rather than discovering it later.

This split is the whole point: personal workspaces are isolated deliberately,
and this measurement does not need to breach that.

## 4. The protocol

Four phases, and **phase 2 before phase 3 is the whole point**:

| phase | who | what |
|---|---|---|
| 1 | teammate | export two months, run the probe, sanity-check the corpus |
| 2 | teammate | write their own reading of their own card — **before seeing ours** |
| 3 | teammate | read the baseline card, write a comparison |
| 4 | us | review all comparisons side by side, mark each finding reproduced / inverted / unique |

Phase 2 exists because if they read our numbers first, they will find our
numbers. Anchoring would make the exercise confirm itself, which is exactly the
failure mode Part 6 was written about.

---

## 5. The prompt to send

Send this verbatim. It is written for their coding agent, not for them.

> **The fetch command below is pinned to commit `aaaf952f60`, which has been
> verified to contain the probe with `--no-frustration`.** Leave it pinned. A
> branch name there — `?ref=feat/agent-usage-advisor-ideation` — reads fine and
> silently hands Monday's reader a different script from Thursday's reader, and
> neither of them can tell. If you amend the probe, re-pin this to the new SHA
> and re-send to anyone who has not yet run it; a card produced from a different
> build is not comparable and cannot be made comparable after the fact. A URL
> that visibly fails is recoverable; four incomparable cards are not.

````markdown
I'd like you to measure my coding-agent usage over the last two months and
compare it against a baseline from a colleague's account. Please work through
this in order and do not skip ahead to the comparison.

## Ground rules

- Use the probe script exactly as given. Do NOT recompute any metric by hand,
  do NOT invent your own thresholds, and do NOT substitute a different
  definition of any number. The script is the shared definition — that is the
  entire reason it exists. If you think a definition is wrong, say so in your
  write-up; do not quietly change it.
- Do not export spans. The probe does not need them and they contain prompt and
  command text.
- Everything you produce stays local except two files I will send on: a JSON
  card of aggregates, and your written comparison.

## Phase 1 — measure

1. Make sure the LangWatch CLI is available and logged in:

   ```bash
   npx langwatch@latest --version
   npx langwatch@latest login          # skip if already authenticated
   ```

2. Find which projects you have coding-agent data in:

   ```bash
   npx langwatch@latest projects list
   ```

   If that refuses with a project-scoped key, just use the project you are
   logged into and note which one it was.

3. Export two months of coding-agent traces, **per project** you use for agent
   work. Run this from a directory OUTSIDE any repo checkout — a repo's `.env`
   can point the CLI at a dead localhost endpoint:

   ```bash
   mkdir -p ~/agent-usage && cd ~/agent-usage

   LANGWATCH_ENDPOINT=https://app.langwatch.ai \
     npx langwatch@latest trace export \
       --origin coding_agent \
       --start-date 2026-07-12 \
       --end-date 2026-09-12 \
       --limit 100000 \
       --format jsonl \
       --output my-agent-traces.jsonl
   ```

   Add `--project <idOrSlug>` and a distinct `--output` name for each extra
   project. If the export reports fewer traces than the total it found, say so.

4. Fetch the probe and run it:

   ```bash
   gh api "repos/langwatch/langwatch/contents/dev/scripts/agent-usage-probe.mjs?ref=aaaf952f60742ab9abd15528ab2aaf04bcb266d9" \
     -H "Accept: application/vnd.github.raw" \
     > agent-usage-probe.mjs

   node agent-usage-probe.mjs my-agent-traces.jsonl \
     --label "<your name> — <project> — 2mo" \
     --out my-card.json
   ```

   That `ref` is a commit SHA rather than a branch name on purpose: a branch
   moves, and four people fetching "the probe" on four different days would
   quietly be running four different scripts. Fetch that exact SHA. If the
   command fails, tell me — do not substitute a branch name or a copy you
   already have lying around.

5. The probe also scores a **frustration signal** from your own prompt text —
   two word lists, profanity and "I already told you"-style repetition — and
   puts **rates only** in the card: no text, no matched words, nothing
   quotable. It runs on your machine over your own export. It is testing three
   specific claims: that frustration roughly doubles between the first and last
   third of a session, that profanity rises *before* a compaction while
   repetition rises *after* it, and that per-model differences are one-session
   artefacts rather than model properties. If you would rather it did not run,
   pass `--no-frustration` — same script, same SHA, that one section reports
   `disabled` and every other number in your card is bit-for-bit identical.
   Don't edit the script instead: a fork changes every other definition too,
   and then nothing in your card is comparable, not just that section.

6. Sanity-check the corpus before you trust anything downstream, and tell me
   what you found:
   - Does `total_cost_usd` look roughly like what you actually spent? If it is
     wildly off, the export is incomplete or the window is wrong — stop and say
     so rather than analysing a broken corpus.
   - How many sessions? Under about 20 and the percentile figures are noise —
     report them with that warning attached.
   - **Which harnesses show up, and does that match how you actually work?**
     Read the `harnesses` breakdown out to me explicitly. On the baseline
     account it is 99.9% `claude-code` — not because that is all the person
     used, but because Codex work produced 17 traces and $0.04 and Kimi work
     produced nothing at all. **If you use more than one agent and only one
     appears, that is a coverage gap, not a fact about your behaviour**, and
     everything else in your card describes only the instrumented part. Say so
     plainly rather than letting the card imply otherwise.
   - **What does `frustration.english_like_pct` say?** Both word lists are
     English. If most of your prompts are not, the probe prints a LEXICON
     COVERAGE warning and every rate in that section means *not measured* — a
     0.0% profanity row is then a statement about the lexicon, not about your
     temper. Same class of mistake as the harness gap above: absence of a
     measurement reads exactly like absence of the thing.
   - Which models show up, and in what proportion?
   - What fraction of traces have no `thread_id`? Those are invisible to every
     session-grained number.

## Phase 2 — your own reading, BEFORE you see anyone else's numbers

Do not look at the baseline yet. From your own card alone, write
`my-reading.md` answering:

1. Where does your money actually go? Name the top three cost concentrations
   you can see in your own data.
2. What is the single biggest lever you would pull, and roughly what would it
   save? Use the card's own numbers.
3. What in the card surprised you or contradicts how you think you work?
4. What does the card fail to capture about how you actually use agents?
   Be specific — this is the most valuable answer of the four, because it tells
   us what the product would miss.

Keep it short. Half a page is fine.

## Phase 3 — compare

NOW read the baseline card you were sent alongside this prompt
(`baseline-card.md`). For each of its headline findings, write
`my-comparison.md` marking it:

- **REPRODUCED** — same direction, comparable magnitude. Give your number.
- **DIRECTIONALLY SIMILAR** — same direction, very different magnitude. Give both.
- **INVERTED** — your data says the opposite. Give your number and, if you can,
  say why (different harness, different work, different model mix).
- **NOT APPLICABLE** — your corpus cannot test it. Say what is missing.

Then answer three questions:

1. Which baseline findings look like properties of **coding agents**, and which
   look like properties of **that person's working style**?
2. Is there anything large in your data that the baseline has no concept of?
3. If we shipped the baseline's thresholds as product defaults tomorrow, which
   one would misfire on you first?

## Phase 4 — send back

Send me `my-card.json`, `my-reading.md` and `my-comparison.md`. Nothing else —
do not send the raw export.
````

---

## 6. The baseline card to send with it

Send this as `baseline-card.md`, and **only as part of phase 3** — the prompt
above tells them when to open it.

> **Provenance.** One person, one primarily-TypeScript monorepo, 2026-07-12 to
> 2026-09-11. 17,463 traces, 273 sessions, $33,116.77. Harness: Claude Code.
> Models: `claude-opus-5[1m]` dominant, `claude-fable-5` secondary. Produced by
> `agent-usage-probe.mjs` 1.0.0 — the same script you just ran.
>
> **Read the window carefully.** Nominally two months, but 97% of the spend falls
> in the last 31 days: the first month contributes 483 traces and $1,198. The
> `cost_per_day_usd` on this card is therefore meaningless — it averages over a
> half-empty window. Compare shares and distributions, not daily rates.
>
> One reassuring thing: running the same probe over the last month alone moves
> every headline by less than three points (carry 279→286, top-1% 46.9→48.7,
> floor share 24.6→25.1). These are not artefacts of where the window was cut.
>
> This is **one sample**. It is a hypothesis to test against yours, not a
> standard to meet.

| finding | baseline | what would falsify it |
|---|---|---|
| spend is a power law | top 1% of sessions = **46.9%**; largest single session = **40.9%** | a flat distribution, or a top-1% share under ~20% |
| long sessions dominate | sessions over 3 days = **4.0%** of sessions, **50.1%** of spend | long sessions rare or cheap in your data |
| context carry is the cost | per-session median carry ratio **279:1** (pooled 401:1) | a median under ~50:1 |
| big windows hold the money | peak context over 500k = **83.0%** of spend | most spend under 200k peak |
| there is a large static floor | first-context median **68,930** tokens; ≈**24.6%** of all cache reads | a floor under ~20k, or a share under ~10% |
| most traces are noise | **29.1%** of traces are under $0.01 and carry **0.0%** of spend | a corpus with no light-trace population |
| compaction is not rare | **764** context resets across **28.2%** of sessions | near-zero resets |
| **no long-context premium** | realised rate **falls** with context: $0.92/M at 50–100k → $0.65/M above 700k; within a single model, $0.81/M → $0.57/M | a rate that *rises* with context on your models |
| **checkpointing is the largest lever** | capping context at 300k ≈ **42%** of read tokens (~$14.0k); at 200k ≈ **54%** (~$17.7k). Upper bound — quality loss not modelled | a much smaller share, i.e. your sessions already stay short |

Frustration findings too (5,467 prompts, 83 profanity events — small, so treat
direction as the claim and magnitude as noise):

| finding | baseline | what would falsify it |
|---|---|---|
| frustration rises through a session | first third **1.02%** → last third **2.17%** (2.1×, p=0.009); aimed repetition 0.24% → 0.90% (3.8×, p=0.011) | flat or falling across thirds |
| profanity **leads** a compaction | **2.38%** in the 5 prompts before a reset → **1.23%** in the 5 after (p=0.003) | higher after than before |
| repetition **lags** a compaction | **0.56%** before → **1.43%** after (2.5×, p=0.002) | higher before than after |
| it is *not* about context size | within one session cohort, splitting by context instead of position reverses the effect | a clean context correlation that survives a within-session control |
| per-model differences are artefacts | Sonnet reads 3.70% vs 1.52% baseline and survives a length control at p=0.0003, then dies: 14 events, 4 sessions, **7 from one** | a model difference where no single session holds more than ~⅓ of the events |

**On that last row especially — check `largest_session_share_of_events_pct` on
every `by_model` row of your own card before you believe it.** It is the column
that killed the most convincing-looking finding in this set.

## 7. How we read the results

Lay the cards side by side and mark every row. The decision rule, fixed in
advance so we cannot rationalise afterwards:

- **4/4 reproduced** → a general detector, threshold still calibrated per tenant.
- **2–3/4** → real but conditional. It needs a stated condition (harness, work
  type, model) and belongs in the per-harness knowledge table, not a default.
- **1/4** → folklore. It goes in the document as one person's observation with
  the sample size attached, and nothing in the product depends on it.
- **Anything inverted anywhere** → the finding is wrong as stated, and the
  version in Parts 1–5 gets retracted the way Part 6 retracts its four.

The phase-2 readings get their own pass, separately from the cards. "What does
the card fail to capture" is where the next part of this programme comes from —
it is the only question in the whole protocol whose answer we cannot predict.
