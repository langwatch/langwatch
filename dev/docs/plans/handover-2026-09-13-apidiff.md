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

## The queue after identity (updated through the ops wall)

Progress this session: identity composed and committed (6a7c671691); the api's
`eventing` member wired producer-only over the group queue + the last four
erased-extends fixed (c6d115c2db); ksuid migration landed (23cb2058ce, the
user's third session). Boot now reaches **ops** and stops at
`members.createCapability is not a function` (ops.app.ts:554) — lane
`ops-composition-green` is on it (recipe: the deleted 491-line
ops.composition.ts; exemplar: the identity commit).

**A hazard boot cannot see, measured, not yet audited:** boot sailed PAST
several module apps that read `setup.members.*` while declaring no
`reads(...)` — langy(11 uses) dashboard(1) feature-flag(3) topic(2) and
possibly automation/analytics (behind ops: organization(19) scenario(14)
stored-object(8) may still fail loudly). An App handed `{}` that only stores
`setup.members.X` wires `undefined` into its graph and boots green; it fails
at first use, far from the cause. After boot goes green end-to-end, EVERY
module in that scan list needs the identity treatment or an explicit
verdict that its members uses are dead code — apidiff's probe phase will
catch the ones with documented operations, but worker-only capabilities and
lazily-hit paths it cannot.

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

## Pattern-list addition (2026-09-13, from the worker drive, confirmed twice)

**The error path is a seam too, and it can be built-but-never-connected like
any other.** `tools/dev-runtime`'s backend entrypoint swallows a worker boot
REJECTION: members close (redis+pg), no fatal is logged, the process neither
exits nor serves, and the outbox/wake pollers spin on closed pools forever —
a zombie that monitors read as quiet. The identical failure under
`pnpm --filter @langwatch/worker start` logs the fatal and exits through
bootNodeExecutable. Fix (propagate the rejection out of the backend
entrypoint, or log+exit) rides with whoever next touches tools/dev-runtime;
until then, verify worker boots SOLO, never through the dev-runtime lane.
