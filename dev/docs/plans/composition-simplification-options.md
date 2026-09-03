# Composition and install: what is left to simplify

**Written:** 2026-09-03. **Audited:** 2026-09-03, against the working tree.
**Status:** F and I landed; D landed in part; A, B, C, E, G, H, J are open and
three of them need a ruling first (see `open-decisions-2026-09-03.md`).

## Landed

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
| A | Shared config blocks in `packages/config` (redis, postgres, clickhouse, s3, mail, queue, egress), both app configs spread them | `packages/config/src/` still holds only `telemetryConfigDefinition` as a shared block; `api.config.ts` and `worker.config.ts` still carry 59 identical env bindings each | −350 | low-med | nothing |
| B | One absence mechanism: one `AbsenceLog.absent(subject, consequence)`; dedupe the `ApiCapabilityUnavailableError` copies | still 26 `*AbsenceReport` files, 25 `Logged*Absence` classes and 21 `*UnavailableError` classes under `apps/api/src` | −1,300 | medium | nothing; conflicts with C |
| C | Split `api-production.composition.ts`: its `compose*`/`resolve*` methods move to the roots they import; delete the standalone shim | still 4,001 lines, 55 files in `src/app`, `api-standalone.composition.ts` still delegates and does nothing else | ~0 (redistribution) | med-high | after B |
| D | Finish the flatten: `ApiTrpcCollaborators` and `AppTrpcFeaturePorts` still carry type parameters (`app-trpc.collaborators.ts:156`, `app-trpc.features.ts:316`); `agents`/`secrets` are still optional on `ApiApplication.create`; `PinPresent` still repairs `AppRouter` | −550 | medium | steps C and D of `trpc-flatten-review.md` |
| E | Export `AppRouter`, add conformance assertions, generate the api-maps with a Go CLI and delete the hand-written ones | 39 `createFeatureApi<` sites remain; `api-trpc-features.composition.ts:277` still casts `as unknown as TRPCRouterRecord` | −3,200 | high, staged | after D |
| G | Worker installers: `install()` returns an optional closer, delete the 26 handle classes, one ordered array | `orderedFeatureInstallers` is still the 56-line triple-naming array | −420 | low-med | nothing |
| H | One REST registration list replacing the remaining mechanisms | 22 `*rest.mount.ts` files plus `app-rest.packaged-families.ts`, `app-rest.process-features.ts` and five `api-*-rest.composition.ts` roots | −250 | medium | after C |
| J | Web packages export `install` (loaders + drawers); fold `installed-ui-drawers.ts` into the list | unchanged; no web package exports an install object | −900 (10k relocate) | high | governed-package fork decision; after E and I |

## How they interact

A and G touch disjoint files and are near-pure deletion; either can run alone.
B → C → H serialise on `api-production.composition.ts`. D → E is a chain:
exporting `AppRouter` still fails until D's remaining type parameters go, which
is what erases 14 of them to `unknown`. J needs a policy decision first (the
governed web packages forbid `@tanstack/react-query` and `@trpc/*`, which the
folded hosts now use directly) and is much smaller after E.

## Resume point

Start with **A** and **G** in parallel — both are mechanical and neither
touches a file another lane is in. **B** is the next largest win and is the
precondition for C and H. **D**'s remainder is owned by
`trpc-flatten-review.md` steps C and D and needs Alex's ruling on
`ApiApplication.create`'s `features` (decision 3 in
`open-decisions-2026-09-03.md`) before D starts.
