# Composition and install: what is left to simplify

**Written:** 2026-09-03. **Audited:** 2026-09-03, against the working tree.
**Status:** A, F, G and I landed; D landed in part; B, C, E, H, J are open and
three of them need a ruling first (see `open-decisions-2026-09-03.md`).

## Landed

- **A — shared config blocks in `packages/config`.** Thirteen concern blocks
  (`postgres`, `redis`, `clickhouse`, `object-storage` (s3 + azure), `mail`,
  `queue` (GroupQueue), `egress`, `observability`, `logger`, `authz`,
  `runtime-identity`, `licensing`, `github`) now live as
  `packages/config/src/<concern>.config.ts`, each a `RuntimeConfig.define`
  block in the telemetry block's own style, and are spread into
  `apps/api/src/platform/config/api.config.ts`,
  `apps/worker/src/platform/config/worker.config.ts` and (for the one leaf
  that matched, `nodeEnvironment`) `apps/tasks/src/platform/config/tasks.config.ts`.
  Every leaf name and environment variable name is unchanged, so `.env.example`
  and haven stay valid. `RuntimeConfig`/`Config`/`InvalidRuntimeConfigError`
  moved out of `index.ts` into `packages/config/src/runtime-config.ts` first,
  which the new concern files import directly — importing them from `index.ts`
  itself would have created a circular module dependency, since `index.ts`
  re-exports every concern block. `apps/tasks`'s `databaseUrl`/`clickhouseUrl`/
  `redisUrl`/`credentialsSecret` leaves were deliberately left alone: they read
  the same variables but validate differently (`z.string().min(1).optional()`
  and `Config.secret` versus the api/worker leaves' plain
  `z.string().optional()`), and sharing the block would have silently changed
  which blank exports each process accepts. `apps/api`'s
  `blockLocalHttpCalls` leaf was harmonized onto the worker's
  `environmentOneOrTrueSchema` parse (provably the same `"1"`-or-`"true"`
  rule as its old `isEnabledFlag` post-processing) so the shared `egress`
  block could cover both. Net **+365 lines** (14 new files in
  `packages/config/src`, including one shared-block test file, plus edits to
  `index.ts` and the three app configs) — smaller than the `−350` estimate
  predicted, because extracting `runtime-config.ts` and documenting each new
  concern block in this codebase's own dense doc-comment style outweighs the
  duplicate `Config.value` declarations removed from the three app files. The
  real win is one declaration per shared binding rather than raw line count.
- **G — worker installers.** `install()` now returns an optional closer
  (`() => Promise<void>`) instead of a `WorkerFeatureHandlePort`; the 24
  per-feature `*WorkerFeatureHandle` classes are deleted along with the
  `WorkerFeatureHandlePort`/`WorkerFeatureInstallerPort` abstract-class pair
  (replaced by one `WorkerFeatureInstallerPort` interface and a
  `WorkerFeatureCloser` type in `apps/worker/src/features/worker-feature.installer.ts`).
  `WorkerApplication` collects closers instead of handles and runs them in
  reverse on shutdown, same as before. `orderedFeatureInstallers` in
  `worker-production.composition.ts` dropped its own duplicate parameter type
  in favour of `Parameters<typeof WorkerProductionComposition.createFromPorts>[0]`,
  so each installer is named once in the array rather than three times across
  two type declarations and the array literal. Net **-298 lines** across 31
  files (262 insertions, 560 deletions). Automation's and Governance events'
  report-schedule/anomaly-schedule stop() behaviour is preserved exactly, now
  returned directly as the closer instead of wrapped in a handle class.
- **F — delete the glue packages.** `268eb2ed83` deleted
  `packages/enterprise/composition/web` (`@langwatch/enterprise-web`) and
  `packages/platform-api-contract`, pruned `packages/runtime-composition` to
  `resource-scope.ts` + `index.ts`, and deleted the gateway
  `FeatureDefinition` wrapper with it.
- **I — one `uiPage()` helper.** `268eb2ed83` added
  `apps/ui/src/ui/sections/ui-page.tsx`, folded all 36 host adapters into their
  providers (`find apps/ui/src/features -name '*host.adapter.ts'` is now empty)
  and deleted `installed-ui-page-keys.ts` and `mergeUiFeatureInstalls`.
- **D, first half — the tRPC mounting and fold layers.** `3edf367d5a` and
  `0acdb3f67c` deleted all five `app-trpc.*-group.ts` mounting files, the ten
  `withApi*Collaborators` folds, `sealApiTrpcCollaborators` and
  `AnyApiTrpcCollaborators`, replacing the fold chain with one
  `composeApiTrpcCollaborators(halves, gapLogger)` call at
  `api-production.composition.ts:923`. What D still owes is below.
- **Post-merge queue items.** `identity-eventing` folded into
  `identity/server` (`c19373aed1`); `ssrf` folded into `egress`
  (`98bb503a3c`).

## Still open

| # | Option | Verified state on the branch | Net lines | Risk | Depends on |
| --- | --- | --- | ---: | --- | --- |
| B | One absence mechanism: one `AbsenceLog.absent(subject, consequence)`; dedupe the `ApiCapabilityUnavailableError` copies | still 26 `*AbsenceReport` files, 25 `Logged*Absence` classes and 21 `*UnavailableError` classes under `apps/api/src` | −1,300 | medium | nothing; conflicts with C |
| C | Split `api-production.composition.ts`: its `compose*`/`resolve*` methods move to the roots they import; delete the standalone shim | still 4,001 lines, 55 files in `src/app`, `api-standalone.composition.ts` still delegates and does nothing else | ~0 (redistribution) | med-high | after B |
| D | Finish the flatten: `ApiTrpcCollaborators` and `AppTrpcFeaturePorts` still carry type parameters (`app-trpc.collaborators.ts:156`, `app-trpc.features.ts:316`); `agents`/`secrets` are still optional on `ApiApplication.create`; `PinPresent` still repairs `AppRouter` | −550 | medium | steps C and D of `trpc-flatten-review.md` |
| E | Export `AppRouter`, add conformance assertions, generate the api-maps with a Go CLI and delete the hand-written ones | 39 `createFeatureApi<` sites remain; `api-trpc-features.composition.ts:277` still casts `as unknown as TRPCRouterRecord` | −3,200 | high, staged | after D |
| H | One REST registration list replacing the remaining mechanisms | 22 `*rest.mount.ts` files plus `app-rest.packaged-families.ts`, `app-rest.process-features.ts` and five `api-*-rest.composition.ts` roots | −250 | medium | after C |
| J | Web packages export `install` (loaders + drawers); fold `installed-ui-drawers.ts` into the list | unchanged; no web package exports an install object | −900 (10k relocate) | high | governed-package fork decision; after E and I |

## How they interact

B → C → H serialise on `api-production.composition.ts`. D → E is a
chain: exporting `AppRouter` still fails until D's remaining type parameters
go, which is what erases 14 of them to `unknown`. J needs a policy decision
first (the governed web packages forbid `@tanstack/react-query` and
`@trpc/*`, which the folded hosts now use directly) and is much smaller after
E.

## Resume point

**B** is the next largest win and is the precondition for C and H. **D**'s
remainder is owned by `trpc-flatten-review.md` steps C and D and needs Alex's
ruling on `ApiApplication.create`'s `features` (decision 3 in
`open-decisions-2026-09-03.md`) before D starts.
