# Handoff: platform-du-classify

Status: partial
Manifest: .claude/manifests/platform-du-classify.md
Model: sonnet / effort medium (as-launched)
Updated: 2026-09-11 (first and only attempt so far)

## 1. Identity

platform-du-classify, first lane, attempt 1. No prior handoff existed. Stopped
at budget (~160 tool calls) with 52 of ~252 in-scope files classified.

## 2. Objective

Produce a verdict (`superseded` / `gap` / `unclear`) for every non-governance
`DU` conflict left from deleting `platform/app`, saying whether main's edit to
each file is already covered by this branch's rewrite or is a missing
capability.

## 3. Owned paths

    dev/docs/plans/main-merge-2026-09-11/platform-du-verdicts.tsv

That is the only file written. Nothing else was touched.

## 4. Shared paths - do not edit

Everything else in the tree - this lane is read-only elsewhere by design
(three other lanes are editing the live merge concurrently).

## 5. Work completed

- All 13 files >200 lines classified (the highest-risk tier per the manifest).
- All 18 files in the 100-200 line tier classified.
- 21 files in the <100 line tier classified (largest-first within that tier).
- 52 total lines in the output file: 25 `superseded`, 12 `gap`, 15 `unclear`.
- `wc -l` and the verdict-count `awk` both ran clean, matching the Checks
  section of the manifest.

Six confirmed, named `gap` findings worth flagging directly (in the output
file, with full reasoning each):
1. `suite.service.ts` / `suites/errors.ts` / `suite.service.unit.test.ts` -
   modules/suite has no server-side feature-flag gate on a "voice" suite
   target (`VoiceAgentsDisabledError`/`assertVoiceTargetsAllowed` do not exist
   anywhere in modules/suite; the wire schema accepts `"voice"` with no check).
2. `annotation.ts` router - the seek-based one-item-at-a-time queue-walk fix
   (avoiding an offset-pagination skip/duplicate bug) is missing; this
   branch's `prisma.annotation-queue-item.repository.ts` still uses plain
   `skip`/`take`.
3. `GraphCardHeader.tsx` - **confirmed by this branch's own code comment**
   ("THE ALERT BELL DID NOT TRAVEL...") - the add-alert/edit-alert bell into
   the automations drawer, plus inline widget rename (`EditableWidgetName`),
   are both absent from `graph-card-header.tsx`.
4. `DashboardPageBody.tsx` - the `zIndex="docked"` positioned-banner-layer fix
   (banners were being visually washed out by page content bleeding over
   them) is not present in `shell-page-body.tsx`.
5. `scenario.processor.ts` - `voice-nonce-registry.ts` exists in
   modules/scenario/contract but nothing wires the parent/child IPC handoff
   that registers a voice child's Twilio stream nonce.
6. Three suite-evaluator integration test files (`test-suite-run`,
   `test-suite.router`, `test-suites-api`) - the evaluator-attachment domain
   logic and error classes are ported, but no transport-level integration
   test in modules/suite exercises evaluators end to end.

15 `unclear` verdicts, mostly either (a) narrow bugfixes I did not have budget
to verify against their new home, or (b) files whose commits are governance
work (adr-128, agent discovery/sync) but whose paths don't match the literal
exclusion regex (`governance|ingestion-pull|pullers`) - see
`platform/app/ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events.ts`,
`ee/event-sourcing/pipelineSet.ts`, `src/server/metrics.ts`,
`src/server/clickhouse/__tests__/connectionPool.unit.test.ts`, `src/routes.tsx`
- flagged for the governance lane to fold in or explicitly exclude.

## 6. Files changed

- `dev/docs/plans/main-merge-2026-09-11/platform-du-verdicts.tsv` (created,
  52 lines).

## 7. Checks completed

    wc -l dev/docs/plans/main-merge-2026-09-11/platform-du-verdicts.tsv -> 52
    awk -F'\t' '{print $1}' <file> | sort | uniq -c -> 12 gap, 25 superseded, 15 unclear

No test run, no typecheck - no source was changed, per the manifest.

## 8. Current failure

None. This is a budget stop, not a broken check.

## 9. Exact next action

Spawn a fresh `platform-du-classify` lane (same manifest, same output file -
append, do not overwrite) starting from row 53 of
`dev/docs/plans/main-merge-2026-09-11/platform-du-inventory.tsv` after
applying the same filter used here:

    awk -F'\t' '!/governance/ && !/ingestion-pull/ && !/pullers/ && !/openapiLangWatch\.json/ && $3 !~ /platform\/app\/package\.json$/' \
      dev/docs/plans/main-merge-2026-09-11/platform-du-inventory.tsv \
      | sort -t$'\t' -k1,1 -rn > /tmp/worklist.tsv

The next unexamined file (largest remaining) is:

    68	0	platform/app/src/app/api/projects/[[...route]]/app.ts

200 files remain unclassified (files 53-252 of the filtered, size-sorted
worklist). None were marked `superseded` by default - they are simply absent
from the output file.

## 10. Shared-file requests

None.

## 11. Risks

- The 5 files flagged governance-adjacent-but-not-excluded (see section 5b)
  should be re-routed to the governance lane rather than reprocessed here -
  worth a manifest tweak to widen the exclusion regex, or an explicit note
  telling the next lane to skip them too.
- The `unclear` verdicts for narrow bugfixes (`runtime-enrollment`,
  `cliAuthFirstTraceRedirect`, event-sourcing `metrics.unit.test.ts`,
  `agent-test-turn.unit.test.ts`, `agent.service.ts`, `scenarios-api`,
  `scenario.service.ts`, `analytics.service.test.ts`, `langy-turn.service.ts`)
  are genuinely unverified, not soft gaps - each needs one targeted
  diff-plus-grep pass, not a re-derivation from scratch.
- Per-file investigation cost varied wildly (2 calls for an easy match, up to
  12 for `specs/analytics/lwql-workbench.feature`, which needed cross-spec
  reading to confirm the dashboard-widgets-drawer architecture actually
  covers the old workbench-page spec's promises). Budget accordingly: the
  next lane should expect roughly 2-4 tool calls per small file if it wants
  the same confidence level, which will not clear all 200 remaining files
  either - expect another partial handoff.

## 12. Unfinished work

1. Files 53-252 of the filtered worklist (listed above) still need verdicts.
2. The 5 governance-adjacent files already classified as `unclear` here
   should be confirmed in/out of scope with the coordinator or governance
   lane, not reprocessed blind.
3. Re-check the 9 "narrow bugfix, not verified" `unclear` rows listed in
   Risks with a dedicated diff+grep pass each - they are cheap to resolve
   with a fresh budget and were left unclear only because this run was
   husbanding tool calls for the large/risky files first.

## 13. Completion status

Partial: 52 of ~252 in-scope files classified (all of the >100-line tier, plus
21 small files), stopped cleanly at the tool-call budget with the worklist
ordering preserved so a fresh lane can resume at file 53 with no rediscovery
needed.
