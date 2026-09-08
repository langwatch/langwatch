# Wave 1 process wiring: entitlement, presence, share into `apps/api`

**Date:** 2026-09-08 · **Owner lane:** one Opus agent, reviewed by Fable · **Follows:** `1b20a34b78`
(entitlement), `d7d5ea94c0` (presence), share's commit

The three features are converted and committed inside their own folders. What is left is the
process: `apps/api` still composes them through the deleted `compose*Feature` / `refusing*Feature`
twins and the old spend shape. This lane makes `apps/api` install the three features and moves every
reader onto the new types. `apps/api` does not compile as a whole until all 44 features convert, so the
oracle here is: **zero TypeScript errors in any file this lane touches, and no error anywhere that
names entitlement, presence, share, spend, plan or usage.** Errors in other features' mounts are
expected and not yours.

## Entitlement (from the lane report)

`installApiEntitlement({ infrastructure, entitlement: { ...planSources, counter, warnings }, peers: { users } })`
in `apps/api/src/features/entitlement/entitlement.composition.ts` returns `ComposedEntitlementFeature`
(`app: EntitlementApi`, `routers(mount)` → `{ plan, limits, costs }`). Mount functions:
`createPlanTrpcRouter`, `createUsageLimitsTrpcRouter`, `createOrganizationSpendTrpcRouter` in
`entitlement-trpc.mount.ts`. Infrastructure ports the app wants: `UsageCounterPort`, `UsageWarningPort`
(both from `@langwatch/entitlement-server`), plus the existing plan sources.

1. `apps/api/src/app-trpc/app-trpc.composed.ts` — `ComposedSpendFeature` import and the record member
   `spend` become `ComposedEntitlementFeature` / `entitlement`.
2. `apps/api/src/app-trpc/app-trpc.features.ts` — drop the `createPlanTrpcRouter` import; the
   `spendRouters` line becomes `const entitlementRouters = composed.entitlement.routers(mount);`;
   `costs`, `limits`, `plan` read off it (`plan: entitlementRouters.plan`).
3. `apps/api/src/app-trpc/index.ts` — the entitlement re-export block lists
   `createOrganizationSpendTrpcRouter, createPlanTrpcRouter, createUsageLimitsTrpcRouter`.
4. `apps/api/src/index.ts` — the spend block becomes
   `export { installApiEntitlement, type EntitlementPeers } from "./features/entitlement/entitlement.composition.ts";`
   and `export type { ComposedEntitlementFeature } from "./features/entitlement/entitlement.composition.types.ts";`
   (the docblock: an organization's plan, its allowance, and the spend taken against it).
5. `apps/api/src/app/api-production.composition.ts` — imports of `composeSpendFeature`,
   `LoggedApiSpendAbsence`, `refusingSpendFeature`, `ApiUsageStatsPort`, `ComposedSpendFeature` go;
   `usage?: ApiUsageStatsPort` becomes `usage?: UsageWarningPort`; `composeSpend(...)` becomes
   `async composeEntitlement(...)` returning `installApiEntitlement(...)` with
   `peers: { users: this.composedUser.app }`, awaited where `composeSpend` was called;
   the `refusingSpendFeature()` branch has no replacement (install or do not call);
   every `this.resolvePlanProvider(options)` (three sites plus `collaborators.application.planProvider`)
   becomes the booted `this.composedEntitlement.app`. Read the whole method before editing: this file
   is 3,400 lines and the order of the async lane matters.
6. `apps/api/src/app/api-usage.composition.ts` — `composeApiUsageStats` returns
   `Readonly<{ counter: UsageCounterPort; warnings: UsageWarningPort }>`: keep the counter, delete the
   `UsageStatsService.create({...})` block (the app builds it), return
   `{ counter, warnings: ApiComposedUsageWarnings.create({ warnings: composeApiUsageWarnings(options, counter), processName }) }`.
   `class ApiComposedUsageStats extends ApiUsageStatsPort` becomes
   `class ApiComposedUsageWarnings extends UsageWarningPort` with one method:
   ```ts
   async sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning> {
     if (!this.warnings) throw new ApiUsageNotifierUnavailableError(this.processName);
     const notification = await this.warnings.tryCheckAndSendWarning(input);
     if (!notification) return { sent: false };
     return { sent: true, notificationId: notification.id, sentAt: notification.sentAt };
   }
   ```
   Drop the imports of `PrismaUsageMembershipRepository`, `UsageStatsService`, `LimitsTrpcPorts`,
   `ApiUsageStatsPort`.
7. `apps/api/src/features/organization/organization.composition.ts` — `UsageMembershipPort` becomes
   `import type { UsageMembershipRepository } from "@langwatch/entitlement-server"`; the
   `PrismaUsageMembershipRepository.create(prisma)` calls stay.
8. Tests: `app/__tests__/api-trpc-record.test-doubles.ts`, `app-trpc/__tests__/support/app-trpc-features.ts`,
   `features/gateway/__tests__/gateway.composition.integration.test.ts` replace
   `spend: refusingSpendFeature()` with a stub `ComposedEntitlementFeature`;
   `features/trace/__tests__/trace.composition.integration.test.ts` rebuilds its usage stub against
   `UsageWarningPort` + `UsageCounterPort` and calls `installApiEntitlement`. Add
   `features/entitlement/__tests__/entitlement.composition.integration.test.ts` on the annotation
   model (boot the installer, call one procedure through the runtime).

## Presence (from the lane report)

`installApiPresence({ redis, peers: { projects, users }, resources })` in
`apps/api/src/features/presence/presence.composition.ts` returns `ComposedPresenceFeature`
(`app`, `emitter`, `broadcast`, `router(mount)`; same four fields as before, so
`composed.presence.router(mount)` and the `broadcast` / `emitter` readers in langy, trace and scenario
compositions need no change).

1. `apps/api/src/app-trpc/app-trpc.context.ts` — `PresenceService` → `PresenceApi` (import and the
   `presence:` member).
2. `apps/api/src/app/api-production.composition.ts` — imports of `composePresenceFeature`,
   `refusingPresenceFeature` become `installApiPresence`; delete
   `this.composedPresence = refusingPresenceFeature();` and the sync `composePresenceFeature({...})`
   call; in the async lane beside `installAnnotation`, add
   ```ts
   this.composedPresence = await installApiPresence({
     redis: queueInfrastructure?.redis ?? null,
     peers: { projects: this.composedProject.app, users: this.composedUser.app },
     resources: options.resources,
   });
   ```
   threading `queueInfrastructure` and `options.resources` to that point. Presence readers later in the
   sync path (`this.composedPresence.broadcast` / `.emitter` at the export, agent and identity
   compositions) must run after this await: check the order, move the install earlier if a reader
   precedes it.
   **Design call to make and state in the report:** the `!database || !projects` branch used to get a
   refusing presence twin. Presence now needs `ProjectApi` and `UserApi` to install. Either that branch
   does not mount `presence.*` at all (the tRPC record slice goes optional in `app-trpc.composed.ts`
   and `app-trpc.features.ts`), or show that no process ever composes without a project directory
   (then delete the branch). Pick the smaller true change.
3. Four test call sites that build `refusingPresenceFeature()` get a real memory-backed install,
   `installApiPresence({ redis: null, peers: { projects, users }, resources: new ResourceScope() })`,
   which means the surrounding object literal becomes async: `app-trpc/__tests__/support/app-trpc-features.ts`,
   `app/__tests__/api-packaged-rest.usage-guard.integration.test.ts`,
   `app/__tests__/api-trpc-record.test-doubles.ts`,
   `features/gateway/__tests__/gateway.composition.integration.test.ts`.
4. `packages/features/trace/web/**` — 17 import lines in 15 files name
   `@langwatch/presence-web/surfaces/presence-indicators` or `.../surfaces/presence-state`; the
   specifier becomes `@langwatch/presence-web`. Three files import from both barrels and end up with
   two statements from one module; merge them: `ui/sections/explorer/trace-drawer/mode-switch.tsx`,
   `span-tab-bar.tsx`, `viz-placeholder.tsx`. These files carry other lanes' uncommitted edits: change
   the import lines only, with the Edit tool, nothing else in them.

## Share (from the lane report)

`installApiShare({ infrastructure, peers: { dataRetention, permissions }, redis })` in
`apps/api/src/features/share/share.composition.ts` is **async** and returns `ComposedShareFeature`
(`app: ShareApi`, `routers(mount)` → `{ share, pinnedTrace }`). No refusing twin: on a process with no
database the two namespaces do not mount.

1. `apps/api/src/app/api-production.composition.ts` — import `installApiShare`; the sync share ternary
   (~L1014–1027) becomes
   `this.composedShare = infrastructure && this.composedTenancy && this.composedAuthz ? await installApiShare({ infrastructure, peers: { dataRetention: this.composedDataRetention.service, permissions: this.composedAuthz.app }, redis: queueInfrastructure?.redis ?? null }) : undefined;`
   (`peers.projects` and `peers.grants` are gone); every `this.composedShare.service` (five sites)
   becomes `.app`; `composedShare` is `ComposedShareFeature | undefined` like `composedNotification`,
   so `features.share` and `collaborators.application.share` go optional in
   `apps/api/src/app-trpc/app-trpc.composed.ts` and `ApiTrpcFeatureApplication`, or the record entry is
   omitted when absent. Pick the same answer as for presence's no-directory branch.
2. `apps/api/src/index.ts` — `export { installApiShare } from "./features/share/share.composition.ts";`
   replaces `composeShareFeature, refusingShareFeature`.
3. Tests calling `refusingShareFeature()`: `app/__tests__/api-trpc-record.test-doubles.ts`,
   `app-trpc/__tests__/support/app-trpc-features.ts`,
   `features/gateway/__tests__/gateway.composition.integration.test.ts` — omit `share` or install it
   over memory persistence.
4. Type rename `ShareService` → `ShareApi` (import and use) in: `app-rest/app-rest.process-features.ts`,
   `app-rest/__tests__/api-rest.product-families.integration.test.ts`, `app-trpc/app-trpc.context.ts`,
   `features/organization/organization-rest.mount.ts`, `features/organization/organization-settings.effects.ts`,
   `features/organization/__tests__/organization-settings.effects.unit.test.ts`,
   `features/organization/__tests__/tenant-features.composition.integration.test.ts`,
   `features/trace/trace-rest.mount.ts`, `features/trace/trace.composition.ts`,
   `features/trace/__tests__/trace-rest.integration.test.ts`.
5. `tryGetCachedPayload` → `findCachedPayload`: `packages/features/trace/server/src/app/trace.app.ts`
   (the `TraceShareReader` member and its one call) and
   `packages/features/project/server/src/app/__tests__/project-trpc-api.unit.test.ts` (the share stub,
   which also gains `pinTrace`, `findTracePin`, `listTracePins`). Those two files belong to other lanes'
   in-flight work: change these lines only.
6. `packages/features/trace/web/src/ui/sections/explorer/hooks/use-share-trace.ts` and
   `.../trace-drawer/drawer-header/share-trace-dialog.tsx`: specifiers
   `@langwatch/share-web/surfaces/share-link-views` → `@langwatch/share-web/share-link-views`,
   `.../surfaces/share-links` → `.../share-links`.
7. `apps/worker/src/app/worker-tenancy.composition.ts`: drop the `database` key from the
   `withFeature(shareServer, ...)` literal (compiles either way; tidy while there).

Known and not yours: `@langwatch/authz-server` does not compile until its own lane lands, so
`share-server`'s one integration test that imports `@langwatch/authz-server/testing` cannot typecheck
yet; `pinned-trace.trpc.ts` still maps `PinnedToActiveShareError` to a raw `TRPCError` (needs a
`HandledError` code, a separate change).

## Rules for the lane

Opus. Read, Edit, Write tools only (no sed or scripted rewrites); the files above are shared and
several carry other lanes' uncommitted hunks, so change only the lines the task names. Allowed paths:
the files named above and `apps/api/src/features/{entitlement,presence,share}/__tests__/**` for new
composition tests. Never touch `packages/api/**`, `packages/features/**` except the trace/web import
lines, any `*-baseline.json`, `.env*`. No git writes. No re-exports, no `as unknown as`, no `try*`,
no inline `import()`.

Allowed checks: **one** `pnpm typecheck:one apps/api` at the end (it is queued and slow; do not loop
on it), then filter its output to the files you touched and to the words entitlement, presence, share,
spend, plan, usage, Presence, Spend, Entitlement; `pnpm --filter @langwatch/platform-api test:unit
<the test files you touched>`; `npx oxlint <files you touched>`.

## Report

1. Files changed, one line each with what changed.
2. The design call on the no-project-directory branch and why.
3. Typecheck: total error count, the count in files you touched (must be zero), and every error line
   that names one of the three features (must be none). Paste the lines you filtered on.
4. Test output for the files you touched, verbatim.
5. Anything the feature lanes' reports got wrong about the process.
