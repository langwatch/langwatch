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

## Wave 4 — `apps/api` and `apps/worker`

Three candidates, and the first is the most valuable thing this register has
collected: it is not documentation of a design, it is the diagnosis of a live
regression that nobody has fixed yet.

16. **The 400-becomes-500 REST regression, with its root cause and its fix.**
    `apps/api/src/app/__tests__/api-canonical-error.integration.test.ts`, an
    18-line block cut to a one-line pin of today's behaviour. `origin/main`
    answers 400 `malformed_request` for an unparseable body; the
    declared-router runtime answers 500 `internal_error`. The cause, which is
    the part that took someone a day: in `packages/api/src/rest/runtime.ts`,
    `validators()` installs the hook that raises `requestValidationErrorFrom`
    but **not** the wrapper that `build()` in
    `packages/api/src/rest/request.ts:284-301` puts *around* the validator.
    Hono raises a malformed body as `HTTPException(400)` from inside its own
    validator, before any hook runs, and that exception carries no `error`
    string, so it also misses `isStatusCarryingError` and collapses to an
    opaque 500. The test is **deliberately pinned to the wrong behaviour**;
    whoever flips `runtime.ts` back to 400/`malformed_request` must flip this
    test in the same change, and without this note the failing test reads as
    the bug rather than as the alarm.

17. **The kubelet liveness budget the worker's boot ordering is sized against.**
    `apps/worker/src/platform/liveness/worker-boot-plan.ts`. Gone: production
    allows a 30s initial delay plus 6x10s periods, so roughly 90 seconds, and
    the two named things that eat it are a slow GitHub download and slow
    trycloudflare DNS. The paired unit test still carries "~90s", but the
    30s + 6x10s breakdown and both named causes now exist nowhere. The
    ordering constraints survive; the number that justifies them does not,
    which means the next person to add a boot step has no budget to check
    against.

18. **Why `ERR_IMPORT_ATTRIBUTE_MISSING` appeared late, and why it is silent.**
    `apps/worker/src/platform/infrastructure/worker-token-counter.adapter.ts`.
    Gone: `tsx` used to absorb a missing `with` import attribute silently,
    which is the whole reason the failure only started showing up once the
    esbuild-bundled runtime shipped — and that it still fails quietly today,
    because the surrounding catch falls back to a default encoding instead of
    throwing. A silent fallback with no record of its own history is the kind
    of thing that gets rediscovered from scratch.

## Wave 4 — `modules/organization` and `modules/user`

One candidate. The lane judged its other two recoverable from the code and was
right: both keep the technical cause and drop only forensic detail.

19. **What the `/api/teams` family's silent 404 actually cost.**
    `modules/organization/server/src/transport/team.rest.ts` and its
    `__tests__/team.rest.composition.unit.test.ts`. Both now say only that the
    prior version lost its only caller silently and every operation 404'd.
    Gone: the scale, which is the part that makes the story a warning rather
    than an anecdote — the test factory asked a since-deleted `apps/api` mount
    file to inject an authorization service and a project directory, that mount
    file went out alongside **446 others**, and for a stretch all **nine**
    operations 404'd while **two shipped SDKs, nine reference pages and a
    Terraform resource** kept calling them. A composition root deleted in bulk
    can take a public API surface with it and no test will say so; the counts
    are what convey that this is cheap to do by accident.

### A note for future lanes, not a lost fact

A lane this wave wrote its working file list to `/tmp/w4-files.txt` and had it
silently overwritten by a concurrent lane on the same machine — the contents
became another lane's file list. It caught this before acting on it, and no
repository file was affected. Scratch files belong in a per-job directory, or
at minimum a PID-suffixed name; a guessable `/tmp` path is shared state between
every agent running on the box.

## Wave 4 — `modules/langy` and `modules/authz`

Five candidates from the lane; three are worth keeping, and the second is the
only one in the whole drive to drop a *named security property*.

20. **Why the Langy bucket-coverage invariant exists at all.**
    `modules/langy/contract/src/langy-permission-policy.ts`,
    `LANGY_FAMILY_BUCKET_TOTAL`. The compressed comment keeps the invariant
    (bucket total equals classified-set size) and drops its reason: a family
    counted in two buckets is decided by `classifyForLangy`'s **branch order,
    not by anyone's intent**. The invariant is not a tidiness check — it is
    there because double-classification is a silent, order-dependent bug. A
    future reader who does not know that can "fix" a failing coverage test by
    adjusting the total.

21. **A named security property is now unnamed.**
    `modules/langy/server/src/rules/__tests__/langy-frame-auth.rules.unit.test.ts`.
    The original named three guaranteed properties: tamper-evidence,
    **field-boundary integrity**, and constant-time reject of garbage. The
    compressed version keeps the first and third. Field-boundary integrity is
    the property that stops a value from one field being reinterpreted as
    another under concatenation; a test file that no longer claims it is a
    test file nobody will notice has stopped covering it.

22. **The CLI's per-command JSON response shapes.**
    `modules/langy/contract/src/cards/__tests__/digest.unit.test.ts`. The
    original enumerated them precisely: trace search returns
    `{ traces, pagination.totalHits }`, dataset list `{ data,
    pagination.total }`, prompt/evaluator/scenario lists are bare arrays,
    experiment status is a single run document, analytics is a timeseries.
    The compressed version keeps the first two and collapses the rest to
    "others are bare arrays or documents", losing the analytics-timeseries
    and experiment-status distinctions specifically.

Two further cuts were judged minor and are recorded here only so the count is
honest: a `TODO(merge)` in `langy-composer-palette.tsx` lost its concrete
conflicting-skill example (`lwql-charts` vs `playground-widgets` on
`release_custom_chart_playground`) while keeping the porting instructions, and
`langy-context-target-css.unit.test.ts` lost a quoted scenario title while
keeping the feature-file path. The latter is **not** an enforced
`@scenario "<title>"` annotation — the lane grepped and confirmed the file
carries none — so spec-parity binding is unaffected.

## Wave 5 — `modules/experiment` and `modules/workflow`

Three candidates, all three a *mechanism* compressed to its *effect*. That is
the recurring shape in execution-engine code: the effect is easy to restate
short, the mechanism is what someone actually needed.

23. **How the Lambda SSE prelude breaks the stream.**
    `modules/workflow/server/src/adapters/lambda.workflow-studio-stream.adapter.ts`,
    and the near-identical `channels/http/http.workflow-studio-stream.channel.ts`
    and `adapters/workflow-studio-stream.adapter.ts`. Now says only that it
    "drops the engine's first event". Gone: AWS Lambda response streaming can
    deliver the prelude **in the same chunk as the first SSE frame**, and
    forwarding it raw puts a bare `{` where the parser expects `data: `, which
    is what costs the connect heartbeat. Without the mechanism, the guard reads
    like a workaround for a flaky upstream rather than a precise fix.

24. **What a dropped comparison-evaluator config actually does.**
    `modules/experiment/contract/src/workbench/execution/build-execution-request.ts`,
    `evaluatorOnTheWire`. Now says the "Phase-1/Phase-2 split breaks". Gone: the
    evaluator gets attached to each target cell in Phase 1 as a plain per-row
    evaluator and dispatches nlpgo an **empty payload**, which nlpgo answers
    with a literal `Data required` error. That error string was the only thing
    connecting a confusing runtime failure back to this line.

25. **The DSPy error a silent empty `code` node produces.**
    `modules/experiment` (mapping inference). Now says only that it must fail
    loudly rather than silently build an empty `code` node. Gone: the symptom,
    a confusing `user code must define one of...` DSPy error **on every row**.
    The whole reason the loud failure exists is that the quiet one is
    unrecognisable at the point it surfaces.

### Confirmed about the rule itself

The lane read `collectCommentBlocks` in
`packages/oxlint-rules/grammar/comment-block-policy.mjs` and confirmed it
**merges any run of comment-only lines regardless of delimiter boundaries** —
two adjacent `/** */` blocks with no blank line between them are one block, as
are a `//` line and the `/** */` below it. Two fixes follow from that and both
are now in use: insert one blank line to split the run, or move a discounted
tag (`@vitest-environment`, `@see`) into the JSDoc as its own ` * @tag` line so
the discount regex sees it. The second is the better fix where it applies — the
JSDoc form is what 1,292 files in this tree already use, 746 of them for
`jsdom`, where a directive that failed to register would break the test outright.

## Wave 5 — `modules/api-key` and `modules/dataset`

26. **`extendLoginKeyExpiry` also scopes by name prefix.**
    `modules/api-key/server/src/repositories/api-key.repository.ts` and its
    `prisma.` sibling. The doc dropped "scoped by name prefix as well as
    id/organization/user". This one is not recoverable from the type: the
    interface signature has **no `name` parameter**, so nothing tells a reader
    that the implementation additionally filters by the CLI-login name prefix.
    A caller reasoning from the signature alone will expect a wider match than
    they get.

27. **Why the empty-grid message sits inside the border rather than below it.**
    `modules/dataset/web/src/ui/sections/datasets/editor/dataset-editor-table.tsx`.
    The placement survived; its reason did not. Gone: it sits **inside** the
    grid's border, where the missing rows would have been, because below it the
    reader gets a blank box with an unattached sentence underneath. That is a
    layout decision someone will "tidy up" without the sentence explaining it.

### A pre-existing defect found by the sweep, not caused by it

`modules/dataset/web/src/model/dataset-editor-copy.ts` carries a docblock whose
prose describes `noSearchMatchesMessage` ("Shown in place of the grid when a
search matched nothing…") while physically sitting above `plainRecordCount`,
which has a doc of its own directly beneath it. `noSearchMatchesMessage` itself
has no doc at all. A past reorder stranded it. The lane correctly shrank it in
place and refused to move it, since relocating a comment onto a different
declaration is outside a comment-sweep's mandate — it is recorded here and
fixed separately.

### A second blind spot in the comment-only checker

`comment-only.py` flagged two api-key test files as having changed code when
every one of their 23 changed lines is comment-shaped. The cause is **backticks
inside comments**: its stripper treats a backtick as opening a template literal,
so a comment edit that changes the number of backticks desyncs the state machine
for the rest of the file. This is separate from the regex-literal blind spot
already recorded. Neither check is sound alone — the changed-line pattern check
is blind to JSX `{/* */}` continuation lines, and the strip-and-compare check is
blind to backticks and regex literals. Run both and reconcile the disagreements
by hand; that is what the pair is for.

## Wave 5 — `clickhouse-client`, `group-queue`, `redaction`

The densest slice of the drive (212 findings over 76 files) and the one with the
highest proportion of rules learned from incidents. Five cuts worth keeping.

28. **The measured size of the vendor-error-routing incident.**
    `packages/clickhouse-client/src/logging.ts` header. The two rules and their
    one-line reasons survive; the magnitude does not — routing vendor-client
    errors to the application's error level was **roughly half of one service's
    entire error volume**. A rule with a number behind it survives a "do we
    still need this?" review; the same rule without one does not.

29. **The fix for the aggregating-dimension guard.**
    `packages/clickhouse-client/src/tasks/__tests__/aggregatingDimensionGuard.unit.test.ts`.
    Gone: the concrete remedy `SimpleAggregateFunction(max, T)` and the
    MATERIALIZED/ALIAS exemption. The guard still fails loudly, but whoever
    trips it now rediscovers the fix from ClickHouse documentation rather than
    reading it next to the assertion that fired.

30. **Why a cleanly-terminated hang is not counted as a crash.**
    `packages/group-queue/src/scripts.ts`, `CLAIM_GUARD_LUA`. Gone: the
    SIGTERM-versus-SIGKILL race — a hang that is SIGTERM'd cleanly is not
    counted, because the retirement tombstone lands before the platform's
    SIGKILL — along with the pin to `groupQueue.workerLiveness.unit.test.ts`.
    The same file's `DRAIN_GROUP_LUA` also lost why bytes are measured from the
    envelope's recorded size rather than raw `#value`: a compressed body
    understates memory. Both are concurrency guarantees whose reasons are
    invisible in the Lua.

31. **A dependency deliberately not taken.**
    `packages/redaction/src/contentRedaction.ts` header. Gone: nothing here
    names `PROVENANCE_ATTR_API_KEY_ID`, **because doing so would drag in an
    ingest route**. An absence with a reason is not recoverable by reading the
    file — there is nothing there to read. This is the shape of comment most
    worth keeping and easiest to cut, since it documents what the code does
    *not* do.

32. **`BLOB_RELEASE_GRACE_TTL_SECONDS` and "lazy does not mean four days".**
    `packages/group-queue/src/blobLeases.ts` class doc. Partially recoverable —
    `blobConstants.ts` still documents the constant — but the cross-reference
    and the framing that bounds what "lazy" is allowed to mean are gone.

### How CHECK 2 actually fails, and the check that replaces it

`comment-only.py` flagged `tenantGuard.ts` and `secrets.ts` as code changes.
Both are comment-only; all 179 changed lines across them are comment-shaped and
their non-comment lines are byte-identical to HEAD.

The cause is now understood rather than guessed. The stripper walks characters
and treats `/` + `*` as opening a block comment and a quote as opening a string
— **inside regex literals too**. `tenantGuard.ts` holds
`/(?:^|[\s.(])TenantId\s*=\s*(?:'[^']*'|"[^"]*")/i` and a `"/*"` string literal;
once the scanner desyncs it consumes until the next `*/`, and *how far that
reaches depends on the length of the comments*. So editing comments changes its
output even when no code moved. Backticks in comments desync it the same way.

**Use this instead** — robust, and it is what settled both files:

```bash
git show "HEAD:$f" | grep -vE '^[[:space:]]*(\*|/\*\*|\*/|//)' > a
grep -vE '^[[:space:]]*(\*|/\*\*|\*/|//)' "$f" > b
diff a b     # empty => every change is confined to comment-shaped lines
```

It has one theoretical hole of its own — a multi-line template literal whose
lines begin with `*` or `//` — so it is a better second opinion, not a proof.
The pair still has to disagree in public and be reconciled by hand.

## Wave 6 — `modules/project` and `modules/suite`

### Six shipped source files cite a gitignored path

Not a lost fact — a dangling one, found by the sweep rather than caused by it.
These files carry a comment pointing at `.claude/handoffs/…` or
`.claude/manifests/…`:

```
modules/analytics/server/src/repositories/dashboard-widgets/access.ts
modules/project/server/src/app/project.app.ts
modules/project/server/src/transport/__tests__/project.trpc.composition.unit.test.ts
modules/trace/contract/src/traces-v2.trpc.ts
packages/architecture-enforcer/tests/agent-workflow-protocol.unit.test.ts
skills/_tests/agent-workflow-protocol.scenario.test.ts
```

`.claude/handoffs/` and `.claude/manifests/` are both gitignored
(`.gitignore:191` and `:193`). The referenced files exist on this machine —
`project-trpc-witness-alignment.md` is 10KB and still there — but **no clone of
this repository has any of them**, so the citation resolves to nothing for every
other reader, and to nothing at all once this working copy is gone.

`project.app.ts:85` is the sharp case: it explains why the app *refuses to boot
in `apps/worker`* and defers the reasoning to the gitignored handoff. That is a
load-bearing behavioural rule whose justification is one `rm` away.

The fix is not to delete the citations but to move what they point at into
committed documentation — a `dev/docs/adr/` entry or a `dev/docs/` page — and
repoint them. Until then, treat any `.claude/` reference in shipped source as a
broken link.

## Wave 6 — `apps/ui` and `modules/navigation`

Three cuts, and the second is the one that matters — it is an edge-case
behaviour note, not incident narration, which is the class the brief says to
keep.

33. **A save refused mid-action still refuses that action.**
    `apps/ui/e2e/langy/fake-tab-document.ts`, `catchUpIfBehind`. Gone: "a save
    refused DURING an action still refuses that action, because the tab is
    holding an unsaved edit right then." That is a real rule about when the
    refusal applies, not a story about how it was found, and nothing else in
    the file states it. Someone reading the fake tab now sees that saves can be
    refused but not that an in-flight action is not exempt.

34. **Which settings address redirects, and which are sections of the rail.**
    `modules/navigation/web/src/model/settings-menu.ts`, the Event Sourcing
    `alsoActiveAt` entry. The general reason survives ("these addresses have an
    owner"); the mapping does not — the scheduler address redirects onto the
    schedules section, while the payload store and Deja View are pages of the
    workspace reached from its own rail and projection replay is the drawer.
    Whoever next adds an `alsoActiveAt` entry has the rule but no worked
    example of it.

35. **Why the legacy pill opens on hover, focus and click.**
    `modules/navigation/web/src/ui/elements/legacy-pill.tsx`. Kept: why it is a
    popover rather than a tooltip. Cut: that the open-on-hover/focus/click
    behaviour is what keeps it reachable by pointer *and* keyboard. That is an
    accessibility requirement, and an accessibility requirement with no
    surviving statement is one that gets "simplified" away.

## Wave 6 — `modules/evaluator`, `apps/server`, `mcp/`

This slice was cleared twice: once by a lane that split blocks instead of
shortening them, and once properly after the splits were merged back. The three
facts below were cut by the *correction*, which is the honest cost of meeting
the budget rather than evading it.

36. **Why scanning source text is a safe substitute for constructing the server.**
    `mcp/typescript/src/__tests__/feature-map-tool-drift.unit.test.ts`,
    `registeredToolNames`. Gone: "the registration is always a string literal in
    every case." That single sentence is the entire warrant for the test's
    approach — a regex over source text finds every registered tool only because
    no registration is computed. If someone later registers a tool under a
    built name, this test silently stops seeing it, and the comment that would
    have warned them is gone.

37. **Only one of the three consumers actually renders.**
    `modules/evaluator/web/src/model/evaluation-status.ts`. The merged block
    still names all three consumers — the count, the trace tag, the status icon
    — but no longer says that **only the status icon renders visually**. That
    distinction is what tells a reader which consumer a visual change affects.

38. **The page is split across packages.**
    `modules/evaluator/web/src/behavior/evaluator-api.ts`, the `checkLimit` doc.
    The reason two separate calls exist was softened away. The calls are not
    redundant; they exist because the page spans more than one package, which is
    precisely the condition this whole web-boundaries migration is changing.
    Worth re-checking after that migration lands — it may become genuinely
    redundant, and nothing in the file will say so.
