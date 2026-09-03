# Composition and install: what is left to simplify

**Written:** 2026-09-03, from a read-only measurement of `feat/strict-feature-layout-v0`. **Status:** options for Alex, nothing started. Runs after the origin/main merge lands.

## Current state, in numbers

**apps/api.** `src/app` is 56 files / 25,233 lines. `api-production.composition.ts` is 4,036 lines, one class of ~85 methods (38 `compose*`/`resolve*`), imports 44 sibling roots directly: a star, not a tree. 43 `*.composition.ts` roots; only 8 have any importer other than production. `api-standalone.composition.ts` (72 lines) delegates and does nothing else. Export style is split: 33 roots export a function, 8 export a class, 10 also export a `withApi*Collaborators` spread ending in `as unknown as`.

Absence has **7 mechanisms in use at once**: 96 `absent()` sites, 36 `*AbsenceReport[Port]` abstract classes (two naming conventions), 37 `Logged*Absence` classes, 46 `*UnavailableError` classes (`ApiCapabilityUnavailableError` is declared 5 times in 5 files), 14 `Unavailable*` null objects, 36 `without*()` helpers. 44 abstract ports in apps/api: 13 have zero `extends`, 26 have exactly one; 39 of 44 are single- or zero-implementation.

tRPC: 10 collaborator groups (8,262 lines) exist for diff-contention, quoted in `app-trpc.agent-group.ts:20`; the record is all-or-nothing so grouping buys nothing at runtime; `ApiTrpcCollaborators` carries 19 type parameters. `AppRouter` is exported nowhere: the root is built at `app-trpc.features.ts:494` and cast to `TRPCRouterRecord` at `api-trpc-features.composition.ts:264`. REST is registered in **5 places** (45 entries): `app-rest.packaged-families.ts` (30), `app-rest.process-features.ts` (15), `api-packaged-rest.composition.ts`, three `*-rest.composition.ts`, 21 `*rest.mount.ts`.

**apps/worker.** `src/app` 47 files / 11,150 lines; `worker-production.composition.ts` 2,542 lines with 13 `Logged*Absence` classes inside. 26 installers, all the identical 10-line shape around one `eventSourcing.register(pipeline)`; most handles are `async close() {}`. `orderedFeatureInstallers` is 56 lines naming each installer three times. `catalogue.json` and `job-registry.json` mirror the code by hand.

**apps/ui.** `installed-ui-features.ts` 168 lines (40 loader spreads + 36 api bindings), `installed-ui-drawers.ts` 94 (15 spreads), route table 922 lines / 133 page keys. 39 private feature folders, 14,694 lines: 36 host providers (4,642 lines), 33 host adapters (4,381), 36 route files (2,541) where ~25 of each ~54 lines is the same `FALLBACKS` + `withUiPageGuard` + `withXHost` skeleton (82 guard sites). No web package exports an install object. `packages/runtime-composition`: 781 lines, only `ResourceScope` (40 lines) is used; `RuntimeBoot`, `CapabilityRegistry`, `FeatureRuntime` have no consumer.

**api-maps.** 40 `createFeatureApi<` sites, 38 hand-written `*ApiMap` declarations in 10,999 lines of files. `dev/docs/best_practices/feature-web-data-access.md` already says "nothing proves it matches the real router" and plans generation once apps/api owns the root router, which it now does.

**Enterprise.** `enterprise-api` 4,545 lines, `enterprise-worker` 391, `enterprise-web` **21 lines with no consumer** (only a lint role table names it).

**Shared leftovers.** `platform-api-contract` is 78 lines, self-described "temporary", one consumer (`workflow/web`). `identity-eventing` ↔ `identity-server` is a real manifest cycle and the package's own `index.ts:11` says the reverse import never happens, which 9 files contradict. `ssrf` has one consumer (`egress`) but pairs with `pkg/ssrf/address.go` and shared `testdata/`. `actor` and `otlp` are healthy.

**Config.** `api.config.ts` 1,423 lines / 99 leaves; `worker.config.ts` 1,424 / 90. **59 env bindings are identical** (61% of each), 171 identical source lines. `packages/config` has the machinery and exactly one shared block (`telemetryConfigDefinition`); no shared Redis/Postgres/ClickHouse/S3/Mail/Queue block exists.

## Options

| # | Option | Files | Net lines | Risk | Depends on |
| --- | --- | --- | --- | --- | --- |
| A | Shared config blocks in `packages/config` (redis, postgres, clickhouse, s3, mail, queue, egress), both app configs spread them | 3 + 6 new | −350 | low-med | nothing; telemetry block is the precedent |
| B | One absence mechanism: delete 36 report ports + 37 logged classes, one `AbsenceLog.absent(subject, consequence)`; dedupe the 5 `ApiCapabilityUnavailableError` | ~50 | −1,300 | medium | nothing; conflicts with C, H |
| C | Split `api-production.composition.ts`: its 38 methods move to the roots they import; delete the standalone shim | ~45 | ~0 (redistribution) | med-high | after B |
| D | Flatten the 10 tRPC collaborator groups into one per-feature list; 19 type params → ~14 | ~17 | −550 | medium | before E |
| E | Export `AppRouter`, add conformance assertions, then generate the api-maps with a Go CLI and delete the 38 hand-written ones | 41 | −3,200 | high, staged | precondition met; after D |
| F | Delete `enterprise-web`; move `WorkflowApiRouter` into workflow/contract and delete `platform-api-contract`; prune `runtime-composition` to `ResourceScope` | ~18 | −1,100 | low | one gateway adapter rewrite |
| G | Worker installers: `install()` returns an optional closer, delete 26 handle classes, one ordered array | 27 | −420 | low-med | nothing |
| H | One REST registration list replacing 5 mechanisms, ordering constraint kept explicit | ~8 | −250 | medium | after C |
| I | One `uiPage({ key, screen, permission, host })` helper replacing the 82-site route skeleton | 37 | −840 | low | nothing; route transcript fixture is the net |
| J | Web packages export `install` (loaders + drawers); fold `installed-ui-drawers.ts` into the list | ~77 | −900 (10k relocate) | high | settle the governed-package fork; after E |

Also queued from earlier today (memory `post-merge-cleanup-queue`): fold `identity-eventing` into `identity/server`; fold `ssrf` into `egress/src/ssrf` keeping the Go testdata pairing; Go-shaped config (one leaf constructor per primitive, one `defaults` object, one `validate` step), which is A plus a convention.

## How they interact

A, F, G, I touch disjoint files and are near-pure deletion: about −2,700 lines together, any order, in parallel. B → C → H serialise on `api-production.composition.ts`. D → E is a chain: exporting `AppRouter` likely fails to compile until D removes the merge-function casts that hide inference gaps. J needs a policy decision first (the governed web packages forbid `@tanstack/react-query` and `@trpc/*`, which 36 host providers use) and is much smaller after E and I.

## Suggested order

1. A, F, G, I in parallel (four lanes, disjoint).
2. B, then D.
3. E step 1 (export `AppRouter` + conformance). Stop and measure.
4. C, H, E step 2 (generator), J after the fork decision.
