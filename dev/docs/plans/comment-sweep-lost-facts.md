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

---

## modules/analytics — lanes `comments-analytics` and `comments-analytics-2a`

### ADR candidates from `comments-analytics-2a` (five)

Three of these were forced by a rule defect, not by the budget — see the
rule-mechanics note below.

1. **`server/src/repositories/clickhouse/__tests__/evaluation-runs-join-time-bounds.integration.test.ts`**
   — lost the pinned-shape enumeration the fixture exists to exercise: an
   evaluation scheduled months after the queried window; row versions spread
   across weekly partitions inserted out of order; two versions tied on
   `UpdatedAt`. Also lost: **every other analytics fixture schedules at the
   same instant, so none of them can tell a lower bound from an upper one.**
   That sentence is the reason this fixture is not redundant.
2. **`.../__tests__/memory-safety.integration.test.ts`** — lost "the
   wide-attribute tenant is the whole memory argument": why the fixture uses
   wide `SpanAttributes` rather than narrow rows to make the OOM path
   observable at all.
3. **`.../__tests__/monitor-pass-rate.integration.test.ts`** — the two
   contracts the fix rests on were compressed to one line: daily buckets carry
   **no** pass-rate value (not `0`) for unprocessed days, and a
   `timeScale: "full"` read returns the run-weighted rate. The
   customer-reported divergence narrative (6/6 passed reading 25% vs 100%) was
   dropped, which is fine — incident history belongs in git.
4. **`server/src/rules/__tests__/manifestParity.unit.test.ts`** — dropped a
   disclosed **known gap in the test's own coverage**: the langwatch-saas
   `render-config.sh` is a third list in another repository and cannot be
   reached from single-repo CI. That is a live limitation, not incident
   history, and the lane found it recorded nowhere else.
5. **`server/src/repositories/chartGrid.ts`** — dropped the column/row unit
   definitions and the comparison with `react-grid-layout`'s fluid-column,
   fixed-row model, plus the `chart_grid_eight_columns` migration provenance.
   Lowest priority: the units are still documented at each constant.

### RULE DEFECT: three tags are counted that should be discounted

`comment-block-size` discounts structural JSDoc tags (`@param`, `@returns`,
`@see`, …) because, in the rule's own words, "their count comes from the
signature or the annotation, so counting them would report a length the author
cannot cut". **`@integration`, `@vitest-environment` and `@regression` are not
in that list, so they count as full content lines.**

Consequence: an integration-test file header carrying `@see` (free) plus
`@integration` and `@vitest-environment` (both counted) has budget for exactly
**one** line of prose. That is what squeezed candidates 1-3 above, and it will
squeeze every integration test in every remaining lane — ops, automation,
identity and model-provider all have them.

These three read as directives and markers, not narrative, and an author cannot
delete them: `@vitest-environment` *is* the test's environment selection. They
belong in `STRUCTURAL_TAG_LINE` in
`packages/oxlint-rules/grammar/comment-block-policy.mjs` alongside `@see`.

Fixing this lowers the finding count, but it does so by correcting a
mis-measurement rather than by lowering the bar — exactly the reason `@param`
is already discounted. **Not done yet:** it is a change to the shared
`packages/oxlint-rules` package, which cannot be touched while sweep lanes are
running (see the plugin-crash incident in `.claude/coordinator/LANES.md`).

### One comment whose meaning was reconstructed, not just shortened

`server/src/repositories/clickhouse/clickhouse.field-mappings.mapper.ts:94` —
the original three-line block had its sentences physically interleaved and did
not parse as English ("…SQL builder previously carried here has moved to … .
(`aggregation-builder.ts`). The ADR-034 routing metadata (`availableOn`)"). The
lane reconstructed the intended reading rather than asking. The coordinator
reviewed it: both facts survive — the interface documents the legacy builder's
configuration, and ADR-034's `availableOn` metadata moved to
`../routing/field-availability.ts`. Recorded because it is the one place in the
sweep so far where a lane changed meaning rather than length.

---

## modules/analytics/web — lane `comments-analytics-2b`

Three candidates, and **all three are really about web package boundaries**,
which makes them worth reading alongside
`dev/docs/plans/web-package-boundaries-migration.md` rather than on their own.

1. **The handled-error reader is a fifth copy** —
   `web/src/model/handled-error.ts` (was 19 lines). The file recorded that
   these nine lines are duplicated verbatim in `@langwatch/gateway-web`,
   `@langwatch/annotation-web`, `@langwatch/automation-web` and
   `@langwatch/enterprise-governance-web`, with a stated plan to converge on
   one shared reader once the presentation registry leaves `platform/app`.
   Survived the cut: "trusts nothing from the wire", "pending one shared
   registry". Lost: that there are five copies and what unblocks the merge.

2. **`analytics-link.tsx` is the sixth copy of a policy** (was 18 lines). The
   router-free-link policy of ADR-004, duplicated across `user-web`,
   `gateway-web`, `governance-web` and `organization-web`. The file carried the
   actual **cost/benefit reasoning for not extracting it yet** — six copies
   versus a shared surface. Survived: "sixth copy of this policy". Lost: the
   reasoning, which is the part a future reader needs to decide differently.

3. **The "alert entry points removed" incident**, told across
   `web/src/ui/sections/__tests__/graph-card-header.integration.test.tsx` (13
   lines) and `web/src/ui/sections/analytics/custom-graph.screen.tsx` (16
   lines, a JSX comment). The automations-family move deleted the drawer
   registry entry that the bell and "Add alert" button called; **a web package
   may not import another web package**, so the shortcut cannot be restored
   directly; and this is deliberately "one of the first customers of a
   cross-feature overlay capability" — a forward-looking marker for when that
   capability lands. Survived: a "revisit when the overlay capability lands"
   gist in each.

**Why these three matter beyond the sweep.** Each one is a duplication or a
missing feature that exists *because* web-to-web imports are constrained, and
each carried the reasoning for tolerating it. That reasoning is precisely what
the web-package-boundaries drive needs when it decides what to extract into
`surfaces/*`. Lanes 7-16 of that drive have never run; these notes are evidence
for them, not just losses.

---

## sdks/typescript — lanes `comments-sdk-typescript` and `-2`

Two smaller losses the second lane named: two files had a spec-file pointer
dropped to fit the budget (recoverable from the routes under test), and two
trailing comments were relocated to their own line — semantically identical
after comment-stripping, and verified as such at collection.

## Wave 2

### modules/ops — `1a6a4457fd`

1. **The quantile overflow bucket reports the largest finite bound.**
   `modules/ops/contract/src/ops-latency.ts`. Values past the last real bucket
   are reported at that bucket's bound rather than as unbounded, so a latency
   headline silently understates a tail that ran off the end of the histogram.
   Nothing else in the file restates it and rediscovering it means reading the
   bucket arithmetic. The surviving three sentences keep the overestimate
   direction and the null-versus-zero semantics.

Recoverable, noted only: `latency-windows-card.tsx` dropped that "All time"
means since latency history began recording (the UI label carries it);
`ops-dashboard-content.tsx` dropped the layout rule that anything explaining a
headline number sits above the detail tables (the JSX order carries it);
`ops.api.ts` dropped that a project credential only enriches the report with a
project link (the optional `apiToken` carries it).

### modules/identity — `0c42fbd825`

2. **Why `ON CONFLICT DO UPDATE ... RETURNING` is the only safe shape for the
   address claim.** `prisma.identity-reservations.repository.ts`, 25 lines cut
   to one sentence. Gone: why `DO NOTHING ... RETURNING` is unsafe against a
   concurrent `release()` or `reapOrphans()` racing an insert-then-read; why
   the `SET` is a deliberate self-assignment no-op that exists purely to make
   the row visible to `RETURNING`; and why running without an outer transaction
   is what keeps the row lock out of a lock-ordering cycle. The last two are
   the kind of thing a later editor "tidies up" and breaks.

3. **The pipeline registration that killed the combined backend boot.**
   `identity-composition.build.ts` and its registration test. Registering a
   producer-only pipeline definition beside the process owning the full one
   raised `Pipeline "identity" is already registered`. Both files now say only
   that resolution is lazy; the mechanism — refused outright versus silently
   winning the name with a refusing stand-in — is gone from the tree.

4. **The folded-vocabulary account detachment.** `identity-heads.repository.ts`,
   `tryFindIdentifierIdForAccount`. The mechanism survives (folded vocabulary
   collapses distinct OIDC connections); the incident it caused — keying on the
   folded vocabulary once matched and detached the wrong enterprise account —
   does not.

5. **The approval-inside-the-expiry-window race, worked through.**
   `join-request-lifecycle-dispatcher.service.ts`. The invariant survives
   (announce RECORDED state, require the PENDING to EXPIRED transition); the
   before/after guard-read sequence that shows why it is needed does not.

### modules/model-provider — `76226983f3`

6. **Cells show the final resolved state, never pinned versus inherited.**
   `default-model-cascade.ts`. Pinned and inherited are only distinguished in
   the edit drawer. A design decision invisible from the pure functions — a
   reader has to already know to look in the drawer.

7. **The exact headers redirect-refusal protects.** `ssrf.model-provider-egress.service.ts`.
   The general reason survives ("could leak an API key"); the enumeration
   `x-api-key` / `x-goog-api-key` / `xi-api-key`, which is the security-relevant
   part, appears nowhere else in the file.

8. **The copy-consistency pointer.** `connection-verdict-copy.ts` was kept in
   step with the `platform/app` presentation registry by
   `provider-refusal-copy.unit.test.ts`. Neither side now points at the other.

### modules/automation — `4b9eb9b57b`

9. **An unknown caller must still throttle, not bypass.** `automation.app.ts`,
   `resolveUnsubscribeView`. The surviving sentence says the public
   unsubscribe read throttles against a shared bucket to resist token
   brute-forcing. What is gone is the part that matters when someone later
   "simplifies" it: a request carrying a *missing* address must still consume
   from the bucket rather than short-circuit past it, because a bypass on the
   unknown-address path is exactly what makes enumeration cheap.

10. **Why Slack previews use unicode emoji rather than `:emoji:` codes.**
    `contract/src/templating/defaults.ts`. Chosen for preview consistency;
    the rationale is now compressed to "mrkdwn_escaped before rendering" and
    the emoji decision itself is gone. Low value, recorded because the rule is
    to name every cut fact rather than decide silently that one did not matter.

    Noted while cutting: two adjacent `/** */` blocks here had no code between
    them, which oxlint counts as one block. They read as though each was meant
    to precede its own export before the file was reordered, leaving one
    orphaned. They were merged losslessly rather than guessing intent.

### packages/eventing — `498a39009b`

None parked. Blocks that read as narrative (the ATOMIC LEASE comment in
`scheduler.service.ts`, "DECLARED, not incidental" in `redisCachedFoldStore.ts`,
the V8-quoting incident in `foldCacheEntry.ts`) were compressed to their
load-bearing sentence rather than cut.

Unrelated, flagged so it is not mistaken for residue: a `no-port-vocabulary`
finding at `server/maintenance/process-retention-sweep.intent.ts:14`.

## Wave 3

### modules/auth — `55322af683`

11. **The two facts behind `isCeremonyAbandoned`.** `passkey-failure.ts`, 16
    lines cut to one sentence, and the clearest attack-shape-plus-defence pair
    the sweep has hit. Gone: (a) WebAuthn reports a dismissed sheet, a
    superseded request and an abandoned prompt *identically* to "no credential
    matched", deliberately, so that watching the prompt tells an attacker
    nothing; (b) the better-auth passkey plugin does not throw on an abandoned
    ceremony — it **resolves**, carrying a synthetic `code:
    ERROR_CEREMONY_ABORTED` / `status: 400`, a refusal's clothes on something
    the server never saw. (b) is the whole reason the check reads the resolved
    `code` instead of a thrown exception's `name`, and it now looks arbitrary.

12. **Why one shared passkey mapping function exists at all.**
    `passkey-failure.ts`, top of file, 18 lines. Before it, every ceremony
    failure — a thrown `DOMException`, or the plugin's `{ code, status }`,
    neither matching the flat `{ error: "<code>" }` that `readHandledError`
    reads — fell through to the generic "Something went wrong" line. It is
    shared across the sign-up button, the sign-in button and the address
    field's autofill offer precisely so those three cannot map one refusal
    three different ways, which is what used to happen.

Recoverable, noted only: `cli-device-session.repository.ts` dropped that the
token index self-evicts once none of its tokens can be live (the kept sentence,
that index expiry must outlive every token it names, implies it);
`credential-sign-in-form.tsx` dropped that an absent `onSignUpStarted` means an
existing account (the prop's optionality carries it).

### modules/coding-agent — `0010609582`

None parked. Every fact nothing in our code can prove was kept inside the
shortened block: the dogfooding corpus sizes, the live-verified wire behaviour
of the four external harnesses, the PR #5708 regression and the 2026-07-31
quadratic backlog incident. That is the right instinct for this module — an
external harness's behaviour is not derivable from our source and no test pins
it.

### enterprise/modules/governance — `c8b3268d29`

13. **A retraction is timestamped by the day it corrects, not the day it
    arrived.** `contract/src/pulled-usage.events.ts`, `PulledUsageRetracted`,
    38 lines. `occurredAtMs` must carry the corrected day because the daily
    comparator re-derives days from events — timestamp it on arrival and the
    correction lands on the wrong day. Paired with it: the three address
    dimensions are **required** on `PulledUsageRetracted` while
    `PulledUsageObserved` may default them, because a retraction has no
    pre-existing append-only history to read a default out of. Both survive
    implicitly in the per-field comments; the cross-field rule tying them
    together does not.

14. **A partially failed adapter should bank its progress, not discard it.**
    `contract/src/puller.ts`, `PullResult.unreadPage`. Return the advanced
    cursor, the events already in hand, *and* the flag — rather than throwing
    the batch away. The flag and its purpose survive; the pattern adapter
    authors are meant to follow does not.

15. **The removal condition for the `IconGlyph` wrapper.**
    `source-type-icon-glyph.tsx`. Gone: the upstream citation `d4ea7c08bd`,
    the statement that `@langwatch/design-system`'s `IconGlyph` is outside
    this port's writable scope, and the explicit trigger — a design-system
    change adding `testId` to `IconGlyph` directly would let the wrapper go.
    The `display: contents` workaround's what and why survive; the condition
    under which someone should delete it does not, which is how workarounds
    become permanent.

Citations verified still in the tree after the sweep: `Ariana QA finding G13`
(wrapped across a line break, so a single-line grep misses it), all six
dark-mode contrast ratios, and the `ISO 8601` reference.
