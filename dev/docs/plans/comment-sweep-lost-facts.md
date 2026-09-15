# The comment sweep's lost facts and ADR candidates

**Live register, opened 2026-09-16.** The lint-to-zero drive's wave 1 cuts
6,168 over-long comment blocks to a 5-line budget. Most of what goes is
narration. Some of it is not, and this file is where the "not" is kept.

**Why this file is tracked and the handoffs are not.** Lane handoffs live in
`.claude/handoffs/`, which `.gitignore:191` excludes. A fact recorded only
there survives exactly as long as nobody deletes the file, and the sweep runs
across seventeen lanes. Anything a lane reports as compressed-out gets copied
here at collection, so the record outlives the lane that found it.

**The standing decision this implements.** The user twice refused to raise the
5-line maximum: *"what comments need to be 5+ lines? if it's that important,
ADR it."* So the intended destination for everything below is an ADR under
`dev/docs/adr/`, with a one-line pointer left in the code. Until that ADR is
written, the text here is the only copy outside git history.

## How to use this register

- A lane never writes the ADR. It cuts to the shortest honest form and names
  the candidate in its handoff.
- The coordinator copies the candidate here when it collects the slice, with
  the commit that removed the text, so `git show` can recover the original.
- ADRs get written in batches once the sweep has produced its full list, not
  one per lane. Each one, when written, gets its pointer line added back into
  the files named here — and the pointer has to fit inside the 5-line budget,
  so an existing content line usually has to give way.

---

## modules/gateway — collected `4e74c73a07`, lane `comments-gateway`

204 findings cleared across 121 files. Recover any original with
`git show 4e74c73a07~1:<path>`.

### ADR candidates (three, all in the spend pipeline)

1. **The pricing and PII invariant** —
   `modules/gateway/server/src/eventing/gateway-spend-commands.process.ts`,
   file header. Spend is priced once at ingest and the event *carries* that
   cost, so no two readers can disagree about it; the event holds no prompt or
   response content and no PII. A financial and security invariant, worth a
   permanent home. The surviving comment kept "no PII", which is **not** the
   same claim as "no prompt/response content".

2. **The status lattice and the attribution-ordering rule** —
   `modules/gateway/server/src/eventing/gateway-spend.projection.ts`, the
   aggregate block. The lost sentence, verbatim:

   > Attribution: admission is the authority, but if the outcome folds first
   > (e.g. a brokered voice session), its attribution fills the row so it
   > isn't priced with no owner.

   **This is the most serious loss in the slice.** It is a behavioural rule,
   not narration, and it is now nowhere in the tree — the lane said so itself.
   Also thinned in the same block: "late confirmation resolves unknown",
   "confirmed never downgrades", and that money copies the outcome's
   "nano-USD + rate identity" so ledger, debits and webhook agree.

3. **The spend-summary accounting and pagination argument** —
   `modules/gateway/server/src/repositories/clickhouse/clickhouse.gateway-spend-events.repository.ts`,
   `readSpendSummaries`. Settled is counted separately from confirmed/failed,
   and paging is by GROUP KEY rather than by cost for a correctness reason
   (a race the cost ordering does not survive). Both are subtle enough that a
   future "simplify this" pass could silently break them.

### Facts compressed but not lost outright

Recorded for a second reading; none is believed load-bearing on its own.

- `adapters/model-catalog.gateway-spend-rating.adapter.ts` — float64 is exact
  to 2^53, so a JS number becomes ClickHouse's Int64 losslessly; and the
  projection-rebuild versus correction-event-stream framing.
- `eventing/gateway-spend-commands.process.ts` — the exact mechanism, that the
  fold, the attributed-user debits and the webhook envelope all copy the same
  `cost_nano_usd`.
- `transport/gateway-internal-config-route.integration.test.ts` and
  `gateway-internal.rest.integration.test.ts` — each named two or three spec
  files; compressed to the single most relevant. The dropped references are
  recoverable from the routes under test.
- `adapters/postgres.gateway-budget-resolution.adapter.ts` — the cross-
  reference to the same trade in
  `worker-trace-capability-services.composition.ts`.
- `repositories/prisma/prisma.gateway-budget-scope-target.repository.ts` — the
  enumeration of who reads it (budgets list, detail page, VK drawer,
  budget-overview service). The *why* was kept: one team never renders under
  two names.

### One deliberate blank line

`transport/__tests__/gateway-platform.rest.integration.test.ts` — a `/** */`
block sat directly above a bare `// @vitest-environment node` line, and
`collectCommentBlocks` merges adjacent comment lines into one block regardless
of comment style, so the two counted as a single 8-line block. A blank line
splits them into two compliant blocks, which is cheaper than over-cutting the
JSDoc. It is the only non-comment character in a 1,328-line diff.

---

## modules/trace — lane `comments-trace`

381 findings cleared across 200 files. Recover any original with
`git show <the trace commit>~1:<path>`.

### ADR candidates (four)

1. **Why the collector and OTLP composition tests exist at all** —
   `server/src/transport/__tests__/collector-rest.composition.integration.test.ts`
   and its sibling `otlp-ingest-rest.composition.integration.test.ts`. The
   dropped narrative: the collector and OTLP doors were once **fully unmounted
   from production while router-level tests still passed green**. That incident
   is the entire reason these composition-level tests exist, and without it a
   later reader has no way to know that deleting them re-opens the hole.

2. **Why none of the six OTLP members may be optional** —
   `server/src/transport/otlp-ingest.rest.ts:149`. Dropped: "a shared name
   would be one door silently reading another's answer", and that the failure
   surfaces as "a 500 on a customer's first export".

3. **The DateTime64/timezone verification trail** —
   `server/src/repositories/clickhouse/__tests__/trace-analytics.repository.unit.test.ts`.
   Dropped the exact conditions under which the fix was verified:
   `TZ=UTC`, one worker, Date-suite loaded first. Without them the test's
   passing says less than it appears to.

### A method bug this lane found, worth carrying to every later lane

oxlint reports a block's line count **post-discount** — structural JSDoc tags
(`@param`, `@see`, …) and `@lint-keep` lines are subtracted before the number
is reported (`comment-block-size.rule.mjs:146`). A lane that treats the
reported count as a raw line range and replaces that many lines **eats the
following code line**. It happened twice here
(`span-storage.repository.ts`, `span-token-estimation.service.ts`), and twice
more from a second cause: splitting one file's findings across two batches
without re-deriving line numbers that the first batch had already shifted
(`trace-spool.service.ts`, `flatten-messages.ts`).

All four were caught and repaired by the lane before it finished, and the
coordinator confirmed the repair independently — the comment-stripped
comparison reported 0 of 200 files with changed non-comment text. But the trap
is generic: **never replace by reported line count; re-read the range, and
re-derive line numbers after every edit to the same file.**
