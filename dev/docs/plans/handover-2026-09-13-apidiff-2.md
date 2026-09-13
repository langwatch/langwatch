# Drive: get `apidiff` to a report — ENTRY POINT, supersedes handover-2026-09-13-apidiff.md

Written 2026-09-13 ~18:30, coordinator handing off mid-run. Two live items
need picking up within minutes of reading this; they are first.

## LIVE ITEM 1 — a clean apidiff run is IN FLIGHT

    work root:  .apidiff/20260913-182700
    output:     /private/tmp/claude-502/-Users-lw-Source-github-com-langwatch-langwatch/8d4b2972-b4c3-4e41-91f1-23d460ef2057/tasks/bye4jzydp.output
    report (if it prints): /Users/lw/.claude/jobs/cbbfd403/tmp/apidiff-report.json

Full clean run (no -keep, no reuse): install both sides ~4 min, migrate,
seed, boot both, probe, compare. Read the output file's tail. Verdicts:
- **exit 1 + report file = SUCCESS** — the drive's first-ever report. Copy
  the report somewhere durable (the jobs tmp dir dies with its job), then
  work its findings (see "After the report").
- exit 2 "health branch" — read the LAST error in
  `<work-root>/logs/branch.log` **comparing timestamps** (the file survives
  reruns; a stale error from an earlier run sits above the real one — this
  cost us twice today).
- exit 2 at "install branch: ERR_PNPM_OUTDATED_LOCKFILE" — a lane edited a
  package.json mid-window again; see LIVE ITEM 2, re-sync (`pnpm install`,
  announce it first), re-launch the same command:

    .bin/apidiff/apidiff run -no-haven -main-ref origin/main -json -report <file>

## LIVE ITEM 2 — a cross-session package.json FREEZE is ACTIVE

The sibling session ("visualdiff", reachable via SendMessage to
`uds:/tmp/cc-socks/50792.sock`) froze all package.json edits in its lanes at
our request, until we confirm the run is past its install phase (~4-5 min
in, the output prints `migrate branch:`). **Send them the all-clear as soon
as install passes or the run dies** — they are holding work on it, and their
worker solo boot launches on your ping. Failing to send this strands their
drive.

## What today established (do not re-derive)

The branch's one defect family: b383462d96 moved installation to
`withModules(serverModules)` and deleted ~5k lines of hand composition, but
modules never learned to build their own collaborators, and `pnpm typecheck`
has NEVER checked the applications (declarations pre-pass short-circuits),
so none of it was visible until boot. Today both sessions converted, in
order of the walls boot named:

  identity 6a7c671691 · ops 2c2dbc6528 · stored-object fde07dc3c3 ·
  organization d9b888e858 · trace 31dffe705a · analytics f8f8fde599 (+
  workbench surface 591178f57a) · automation 52bfd43fbd · monitor 5db2246288 ·
  evaluator 932722a5df · scenario (partial: c6cc91a804, e598690ba8)
  — plus, sibling session: feature-flag 69a8eb70ac · topic fd05332478 ·
  langy + presence token a24a63479f · dashboard f692ad1dc4 · suite/workflow/
  evaluation call sites 9cc2085bf5 · worker foundation + mini-apps
  (019d94914d, 418f69ddae, 8621b412bd, 94f635a613) · worker closed doors
  e87444e69e
  — process seams (coordinator): the api's eventing member + last
  erased-extends c6d115c2db · the api's tRPC door + process fact bindings
  1980456999 · feature-flag resolved-config line 93c292aabb.

The conversion recipe is stable after ~12 instances: App declares
`reads(...)`/`configSchema`/`dependencies`; a build file ports the deleted
composition (recipes at `b383462d96^:apps/api/src/features/<m>/...`);
worker-only capabilities keep the deleted code's refusal branches; every
configSchema needs an `apiModuleConfig` entry (a schema parses {} but
refuses undefined); every new import needs its package.json line (vitest
resolves what node ESM refuses). Exemplars in the commits above; manifests
in `.claude/manifests/*-composition-green.md`.

## Division of labor (standing, over the cross-session channel)

Sibling owns: apps/worker/**, dataset + workflow module lanes (in flight,
package.json edits frozen), the visualdiff tool. We own: the api
install-order queue (DONE except scenario's remainder), apps/api process
seams, modules converted above. Claim-first per module on the channel.
A third user-launched session did the ksuid migration (23cb2058ce) and may
be gone. pnpm installs are ANNOUNCED on the channel before running.

## After the report exists

1. Findings triage: expect the recorded refusals to show up as diffs —
   organization's invitation/join doors (builders died with b383462d96,
   unowned), trace live-updates (wire to the presence token from
   a24a63479f — small lane, planned), scenario's remaining triage
   (.claude/handoffs/scenario-composition-green-2.md §11/§12, paused for
   apps/api availability), workflow (sibling converting; api side was
   silent-undefined), automation's filterQuery compiler (does not exist
   anywhere — real gap). The 70 unserved documented operations list:
   `unserved-documented-operations-2026-09-12.md`, split three ways per that
   file.
2. USER-APPROVED lint lanes, manifests written, spawn when convenient:
   `.claude/manifests/lint-vendor-containment.md` (prisma/clickhouse via
   repositories; redis/sendgrid etc via client packages) and
   `.claude/manifests/lint-ban-double-cast.md` (`as unknown as` at error,
   baseline existing). Also queued: consolidate the analytics clickhouse
   adapter (the one shim allowed to live, by repository count).
3. The silent-undefined audit: any module still storing undefined members
   boots green and fails at first use; the probe covers documented REST/tRPC
   operations, worker-only paths it cannot.

## Traps that cost hours today (all still armed)

- `-keep`/`-reuse-worktrees` on apidiff: skips DB creation on fresh roots,
  keeps STALE SEEDED STATE (old ports in rows) on old ones, and a killed run
  wrecks the root. Use clean runs now; the walls are gone.
- branch.log persists across reruns — compare timestamps before believing
  the last error.
- frozen-lockfile vs in-flight lanes — LIVE ITEM 2's whole reason.
- tools/dev-runtime swallows a worker boot rejection (zombie, no log): boot
  the worker SOLO to verify, never through the dev-runtime lane.
- `git stash` in this checkout endangers other sessions' in-flight work.
- Commit ONLY by pathspec (dev/scripts/commit-slice.sh).

## State files

Roster: `.claude/coordinator/LANES.md` (no active lanes of ours; header notes
the multi-session arrangement). Handoffs: `.claude/handoffs/*.md` — scenario's
is the one with unfinished work. This file is the entry point; the previous
one (handover-2026-09-13-apidiff.md) is background, and its pattern-list
addition (the dev-runtime error-path seam) still stands.
