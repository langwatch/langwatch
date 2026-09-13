# Drive: get `apidiff` to report — ENTRY POINT, supersedes handover-2026-09-12-apidiff.md

Written 2026-09-13 by the coordinator session. The 2026-09-12 entry point is
stale: its next actions are DONE. Read this instead.

## Measured state (all verified this session, not inherited)

- **Gate 1 PASSES**: `pnpm --filter langwatch build` exits 0 at HEAD.
- **The refreeze is DONE** (`dbc7f57afe`): the generator (`pnpm --filter
  @langwatch/platform-api task openapi-generate <out>`) runs clean — 268
  operations, 64 families — and its output is byte-identical to the frozen
  `apps/api/src/features/discovery/openapi-document.json`. No decision pending.
- **dirty=0**: the 91-file residue is committed as four slices —
  `fcb9500817` (ESM extension/rename/repoint sweep), `9110eeb2f7`
  (startStandaloneApi), `23ede788a4` (visualdiff gateway secrets),
  `1c4116bc96` (detectors + visualdiff handover).
- **apidiff now clears everything up to branch boot**: install, migrate (313),
  seed, scim, fixtures all green on both sides. The branch api then dies at
  `IdentityApp.create` (`identity.app.ts:51`, `latch.ttlMs` on `{}` members) —
  the per-module App-wiring queue, exactly where `c68a154768` said.

## The loop (unchanged, works)

    .bin/apidiff/apidiff run -no-haven -main-ref origin/main -json \
      -work-root <existing> -reuse-worktrees -report <file>

`-no-haven` boots the branch checkout IN PLACE — working-tree edits count.
Branch failure = last `"level":"error"` in `<work-root>/logs/branch.log`.

## Active lane

`identity-composition-green` (sonnet) — modules/identity/server/src/** only.
Manifest has the complete recipe (deleted composition at
`b383462d96^:apps/api/src/features/identity/identity.composition.ts` +
`api-identity-pipelines.composition.ts`; exemplar authz `9ab4161571`).

## The projected queue after identity (static scan, boot is the authority)

Module apps using `setup.members.*` with NO `reads(...)` declared:
automation(21) organization(19) scenario(14) langy(11) stored-object(8)
analytics(3) feature-flag(3) topic(2) dashboard(1). Some may be false
positives (builder-level `members` declarations, guarded reads). Install order
is dependency-driven: fix order so far was model-provider → trace/webhook →
moduleConfig → authz → identity, NOT alphabetical. Let boot name the next one.

## Division of labor (agreed over cross-session channel, 2026-09-13)

A sibling session ("visualdiff") OWNS the worker side: apps/worker link-time
burndown, the 56 erased-extends sites, `@langwatch/audit-log-null`, and the
worker-ops UsageStats a/b/c decision. This session owns the api install-order
queue. The 14 `*TrpcApi` ABSENT symbols in the three enterprise trpc
compositions are ORPHANED (zero importers, measured) — parked behind the
enterprise-tier decision, nobody ports them now.

## After the api boots

Run apidiff for real. **Exit 1 with a findings report is SUCCESS.** Then the
70 unserved documented operations
(`unserved-documented-operations-2026-09-12.md`) and the findings themselves.
