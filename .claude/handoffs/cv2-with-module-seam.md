# Handoff: cv2-with-module-seam

Status: review
Manifest: .claude/manifests/cv2-with-module-seam.md
Model: claude-opus-5[1m] / effort unknown (model `read` from the run; effort not surfaced)
Updated: 2026-09-11 15:10

## 1. Identity

cv2-with-module-seam, first lane on the task, attempt 1. No previous handoff.

## 2. Objective

`withModule(module, { members })` on `ApplicationBuilder` - the per-module seam
carrying a module's OWN collaborators - and the dishonest `as Members` cast gone.

## 3. Owned paths

    packages/runtime-composition/src/{application,module-members,index}.ts and src/__tests__/**

## 4. Shared paths - do not edit

    apps/worker/src/app/*.composition.ts, apps/api/src/app/api-production.composition.ts,
    packages/infrastructure/src/members.ts, packages/architecture-lint/src/**  coordinator
    modules/**                                                                 other lanes

None were edited. `packages/infrastructure/src/members.ts` did NOT need to change.

## 5. Work completed

- `withModule`, two overloads: one argument for a module the pool answers in
  full, two for one whose members are its own. It installs through the same
  `addFeature` as `withModules`, so `withModule(m)` means `withModules([m])`.
- `moduleMembers()` assembles a module's record from its two sources and holds the
  one remaining cast, beside the argument for why it holds and the case it misses.
- `DuplicateModuleMemberError`: a name claimed by both sources refuses at boot.
- The install-site cast is gone. `DeclaredFeature.install` takes the pool's view,
  honestly typed; the module's own `Members` type survives only in the closure
  `addFeature` builds, where the two are folded.
- `ModuleMembersMissing` / `ModuleMembersGuard` exported, mirroring
  `ModuleConfigMissing` / `ModuleConfigGuard`.
- 9 tests in one new file: bag supplied and reaching the App, bag omitted
  (refused, naming the members), no bag needed, the mixed module, the duplicate
  name, `withModule(m)` equal to `withModules([m])`, and two compile-only
  fixtures for the pool-generic installer shape.

## 6. Files changed

packages/runtime-composition: src/application.ts, src/module-members.ts,
src/index.ts (all modified), src/__tests__/with-module.unit.test.ts (added).
Nothing else touched. Nothing committed.

## 7. Checks completed

    rtk pnpm typecheck:one packages/runtime-composition -> clean (exit 0)
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/runtime-composition test:unit -> 15 files, 141 passed
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/monitor-server test:unit src/app/__tests__/monitor-installation.unit.test.ts -> 3 failed, module-side
    VITEST_MAX_WORKERS=2 rtk pnpm --filter @langwatch/feature-flag-server test:unit src/app/__tests__/feature-flag-installation.unit.test.ts -> 4 failed, module-side

## 8. Current failure

Both proof tests now boot - `withModule is not a function` is gone - and fail past
the seam, for the same module-side reason:

    MissingMemberError: Module "monitor" reads the "prisma" member, which this process cannot supply.

Same line for `feature-flag`. Neither test says `withMemoryRepositories`, so both
install the live tier, whose registry claims `prisma`, against a process naming no
member source. Both tests say in their own names that they mean memory.

## 9. Exact next action

Give the two proof tests their tier and re-run them:

    modules/monitor/server/src/app/__tests__/monitor-installation.unit.test.ts:24
      .withModule(monitorServer, {       ->  .withModule(withMemoryRepositories(monitorServer), {
    modules/feature-flag/server/src/app/__tests__/feature-flag-installation.unit.test.ts:23
      .withModule(featureFlagServer, {   ->  .withModule(withMemoryRepositories(featureFlagServer), {

`withMemoryRepositories` is already exported from the package and preserves the
declaration's type, so the bag still typechecks. Then re-run both commands in
section 7. Do NOT make the seam imply a memory tier - `withMemoryRepositories` is
the only place the word memory may be said.

## 10. Shared-file requests

Rename `infrastructure:` to `members:` on `withModule`'s second argument:

    apps/worker/src/app/worker-evaluation-execution.composition.ts:128
    apps/worker/src/app/worker-agent-apps.composition.ts:88
    apps/worker/src/app/worker-tenancy.composition.ts:89
    apps/worker/src/app/worker-coding-agent-app.composition.ts:85
    apps/worker/src/app/worker-ops-app.composition.ts:95
    apps/worker/src/app/worker-scenario-execution.composition.ts:272

`worker-scenario-execution` needs more than the rename: `suiteServer` declares
`reads("clickhouse")` and that root is `createApp({ role: "api", config: {} })`
with no member source, so `clickhouse` is claimed and unanswerable. It needs a
member source naming it - its bag carries `resolveClickHouseClient`, a different
thing. Pre-existing.

## 11. Risks

- Wire differences: none.
- Compile-time completeness of a bespoke bag binds only where the builder's pool
  type is resolved. `installWorkerTenancy<Infrastructure>(builder:
  ApplicationBuilder<Infrastructure>)` leaves the subtraction unresolved, and an
  unresolved mapped type refuses the whole bag (measured: TS2353 naming the first
  key), so the bag is intersected with `Partial` of the module's members. Those
  two roots compile, a partial bag compiles there too, and every runtime refusal
  still holds. Dropping the `Partial` needs those helpers to name their pool.
- A module reading a pool member it never declared with `reads(...)` still gets
  `undefined`. Pre-existing, inherent to the erasure `reads()` exists to survive.
- The new test is in `src/__tests__/` per the manifest's owned path; the other 14
  live in `tests/`. Both are in the vitest run and `tsconfig.test.json`.

## 12. Unfinished work

1. Rename the key in the six worker roots (section 10).
2. Give `worker-scenario-execution` a member source answering `clickhouse`.
3. Repair the two proof tests' tier (section 9) and run them.
4. Convert the remaining eight module installation tests onto the seam.
5. Name the pool type concretely in `installWorkerTenancy` / `installWorkerOps`,
   which makes bag completeness compile-time everywhere (see 11).

## 13. Completion status

Built, typed, documented and green on its own package, and independently
committable: every existing call site compiles and no shared file was touched. The
proof tests reach the App's construction and stop on a tier omission in files this
lane does not own - one call each.

## Decisions

**1. `members:`.** `reads()`, `MemberName`, `MemberSource`, `MembersRead` and
`FeatureSetup`'s second slot all say member, and the tree is mid-rename from
`*.infrastructure.ts`. The tests already saying `members:` are files a lane may not
edit; the six roots saying `infrastructure:` are the coordinator's and are being
rewritten anyway. Accepting both is rejected: it doubles the surface, needs its own
refusal for a caller passing both, and the rename would never finish.

**2. The unsupplied-bag refusal is compile-time.** The bespoke half of a bag exists
only in the type - a declaration carries the `reads(...)` names at runtime and
nothing else - so boot has no bespoke name to print. The refusal is
`ModuleMembersMissing<"evaluators" | "generateId">` on the one-argument overload,
naming the members in the compiler's own message. A `get`-trap proxy manufacturing
a name at boot was rejected: a module reading `members.now ?? default` off an
all-optional bag would throw where `undefined` is correct.

**3. The two sources are complements; no name may appear in both.** `reads(...)`
names are answered process-wide and already refused by `buildClaimedMembers`;
everything else is the module's own and arrives at its install. `moduleMembers()`
merges them, pool view first, and throws `DuplicateModuleMemberError` if a bag key
is also a declared read - there is no answer to which one the App got. The bag's
type subtracts what the pool answers by NAME AND TYPE, not name alone: that lets
a feature flag hand in its own narrow `cache` while the pool holds a `cache` of
its own, and lets a module reading the pool's `clock` need no bag.
