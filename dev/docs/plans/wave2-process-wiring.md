# Wave 2 process wiring: secret, feature-flag, data-retention into `apps/api` and `apps/worker`

**Date:** 2026-09-08 · **Owner lane:** one Opus agent, reviewed by Fable · **Follows:** `9d279eef12`
(secret), `b96cf81b47` (feature-flag), data-retention's commit, and the wave-1 wiring commit.

Same oracle as wave 1: `apps/api` and `apps/worker` do not compile as a whole until all 44 features
convert; **zero TypeScript errors in any file this lane touches, and no error anywhere that names
secret, feature-flag, FeatureFlag, data-retention or DataRetention.** One `tsc --noEmit -p
apps/api/tsconfig.test.json` and one `tsc --noEmit -p apps/worker/tsconfig.test.json` at the end (the
`typecheck:one` wrappers fail in another lane's package before they reach the app). Read the wave-1
wiring commit first: it shows how `installApi*` replaced the twins, how test doubles became real
installs or `createApiFixture` stubs, and how the composition lane order was changed.

## Secret (from the lane report)

`installApiSecret({ prisma, encryption, credential })` in `apps/api/src/features/secret/secret.composition.ts`
returns `ComposedSecretFeature` (`app: SecretApi`, `routers(mount)` → `{ secrets }`, `rest`: the two
mounted REST apps, singular and plural family). `SecretHostContext` in `secret-trpc.mount.ts`.

1. `apps/api/src/api.application.ts` — drop the `SecretService` import and `SecretApp`, `SecretTrpcApi`,
   `SecretTrpcContext`; import `type SecretApi` from the contract and `type SecretHostContext` from the
   mount; `ApiServices.secrets: SecretApi`; the context intersection uses `SecretHostContext`; delete
   `class MissingSecretService` and its docblock; `secrets: SecretApi` in the options and
   `secrets: options.secrets` in the literal (no `instanceof SecretApp` branch); the root router gets
   `secrets` from the packaged record (`composedSecret.routers(mount)`) — delete the
   `SecretTrpcApi.create(...)` line.
2. `apps/api/src/api.process.ts` — `SecretApi` type; drop `SecretApp` and `MissingSecretService`;
   `secrets: SecretApi` required; `secrets: options.secrets`.
3. `apps/api/src/app/api-production.composition.ts` — `SecretApp` import becomes
   `type SecretEncryptionPort` only; drop `RESERVED_PROJECT_SECRET_NAMES`; `ApiSecretRestFeature` import
   becomes `installApiSecret` + `type ComposedSecretFeature`; the two fields `secrets` / `secretApp`
   become one `composedSecret: ComposedSecretFeature | undefined`; `resolveSecretApp` keeps its two gates
   and returns `installApiSecret({ prisma, encryption, credential: (input) => credentials.authenticate(input) })`
   (async); readers: `secrets: this.composedSecret?.app`; the REST mount routes each app in
   `this.composedSecret?.rest ?? []` instead of `ApiSecretRestFeature.create(...)`; the scenario
   composition reads `this.composedSecret?.app`; the tRPC record spreads
   `this.composedSecret.routers(mount)`.
4. `apps/api/src/app-rest/app-rest.packaged-families.ts` — delete the `SecretApp` import, the
   `createSecretLegacyRestApp` import, the `secrets?:` service option, `"secret"` from the family union
   and the `"secret"` family entry.
5. `apps/api/src/index.ts` — `export { installApiSecret }` replaces `ApiSecretRestFeature`; drop
   `createSecretLegacyRestApp`; add `export type { ComposedSecretFeature }`.
6. Delete `apps/api/src/api-secret-rest.feature.ts`. Add `secret: ComposedSecretFeature` to
   `app-trpc.composed.ts` if the packaged-record route is taken (it is: same as every converted feature).
7. Tests: `apps/api/src/__tests__/api-secret-rest.listener.integration.test.ts` rebuilds on the mounted
   REST apps over a memory-backed install (scenarios it binds: *Every transport uses one service*,
   *Legacy REST remains a thin compatibility transport*, *A caller may not reach a scope their
   credential does not cover*, *An authorised credential chooses a project*, *Writes use the
   authenticated user actor*); `api.application.secret-trpc.integration.test.ts`; every
   `new MissingSecretService()` call site gets a memory-backed `installApiSecret` or a
   `createApiFixture<SecretApi>` stub: `app/__tests__/api-trpc-features.composition.integration.test.ts`,
   `features/organization/__tests__/*person-features*`, `features/role/__tests__/*`,
   `features/trace/__tests__/*`, `features/scenario/__tests__/*`, `features/workflow/__tests__/*`,
   `__tests__/api-application.{subscriptions,http,client-address}.integration.test.ts`,
   `__tests__/api-standalone.executable.integration.test.ts`, `__tests__/api-process.lifecycle.unit.test.ts`,
   `__tests__/api.process.unit.test.ts`.
8. Deprecated alias: the old `/api/secrets` compatibility app answered `Deprecation`, `Warning` and
   `X-API-Deprecation-Notice` headers. `dev/docs/plans/api-runtime-defects.md`'s lane reports how a
   mount declares a deprecated alias; apply it to the plural family mount in
   `apps/api/src/features/secret/secret-rest.mount.ts` if the mechanism exists by the time you get here,
   otherwise note it.
9. Baseline line for Fable: `nested-ternary|apps/api/src/api-secret-rest.feature.ts` leaves
   `packages/architecture-lint/src/oxlint-baseline.json` with the file.

## Feature-flag (from the lane report)

`installApiFeatureFlag({ prisma, config, peers: { permissions: AuthzApi, projects: ProjectApi, organizations: OrganizationApi } })`
in `apps/api/src/features/feature-flag/feature-flag.composition.ts` returns `ComposedFeatureFlagFeature`
(`app: FeatureFlagApi`, `router(mount)`). No refusing twin: a process without a database does not
install the feature.

1. `apps/api/src/app/api-production.composition.ts` — import `installApiFeatureFlag`; the assignment
   becomes `await installApiFeatureFlag({ prisma: this.composedDatabase.connection.client, config: options.config.featureFlags, peers: { permissions: <the authz app>, projects: this.composedProject.app, organizations: this.composedOrganization.app } })`.
   **Ordering is the load-bearing change:** today flags compose before `resolveAuthz` and long before
   `composeTenantFeatures`, yet the flags app is read by the tRPC infrastructure and by
   `composeEventing`'s kill switch. Hoist `resolveAuthz` and `composeTenantFeatures` above the flag
   install, and keep the install above eventing and every gated feature. Read the whole compose path
   before moving anything; the wave-1 wiring already reordered presence in the same method.
   Every `this.composedFeatureFlag.app.flags` becomes `this.composedFeatureFlag.app` (eight sites,
   match on the symbol).
2. `apps/api/src/app-trpc/app-trpc.context.ts` — `FeatureFlagApp` → `FeatureFlagApi` (import and
   `featureFlag:` member). `apps/api/src/platform/infrastructure/api-trpc.infrastructure.ts` —
   `featureFlags: FeatureFlagService` → `FeatureFlagApi`.
3. Tests calling the deleted functions: `app/__tests__/api-trpc-record.test-doubles.ts`,
   `app-trpc/__tests__/support/app-trpc-features.ts`,
   `features/gateway/__tests__/gateway.composition.integration.test.ts` (`refusingFeatureFlagFeature()`),
   `features/role/__tests__/role.composition.integration.test.ts`,
   `features/analytics/__tests__/analytics.composition.integration.test.ts` (`composeFeatureFlagFeature`):
   a `createApiFixture<FeatureFlagApi>({ isEnabled: async () => false })` in the `app.featureFlag`
   slot, or a real memory-backed install where the test exercises flags.
4. **Worker.** `apps/worker/src/app/worker-feature-flags.composition.ts` and
   `worker-production.composition.ts`: `PostgresFeatureFlagAdapter`, `FeatureFlagDatabase`,
   `FeatureFlagExperimentDatabase` and `WorkerFeatureFlagDatabase` are gone. Boot
   `createApp(...).withPersistence("postgres", { prisma }).withInfrastructure({ cache: RedisFeatureFlagCacheAdapter.create(redis), config }).withProvided(AuthzApi, …).withProvided(ProjectApi, …).withProvided(OrganizationApi, …).withFeature(featureFlagServer)`;
   the worker foundation apps (`worker-foundation-apps.composition.ts`) already boot authz, project and
   organization, so provide those. Two worker tests read `WorkerFeatureFlagDatabase`; repoint them.
5. **Type rename, 70 files:** `FeatureFlagService` → `FeatureFlagApi` in `import type` positions across
   `apps/api`, `apps/worker`, `packages/enterprise/composition/worker`, and the analytics, auth,
   automation, data-privacy, gateway, langy, ops server packages (`grep -rl FeatureFlagService`).
   Two value uses need a fixture instead: `apps/api/src/app/__tests__/api-trace-spool.composition.unit.test.ts`
   and `packages/features/gateway/server/src/__tests__/support/test-feature-flag-service.ts` (extends the
   deleted abstract class). Tests importing the deleted `@langwatch/feature-flag-server/testing`
   (`MemoryFeatureFlagService`) become `createApiFixture<FeatureFlagApi>({ isEnabled: async () => … })`
   from `@langwatch/test-harness/api-fixture`: `packages/features/analytics/server/src/langwatch-ql/__tests__/access.unit.test.ts`,
   `packages/features/langy/server/src/services/__tests__/langy-access.service.unit.test.ts`,
   `.../langy-key-identity.service.unit.test.ts`,
   `packages/features/ops/server/src/adapters/__tests__/redis-tenant-rate-tracker.adapter.unit.test.ts`,
   `packages/features/ops/server/src/services/__tests__/anomaly-detector.service.unit.test.ts`.
   Many of these files carry other lanes' uncommitted hunks: change the named lines only.
6. `packages/features/ops/web/src/features/feature-flags/ui/sections/feature-flags-content.tsx`:
   `@langwatch/feature-flag-web/surfaces/experiment-catalogue` → `@langwatch/feature-flag-web/experiment-catalogue`.
7. `FeatureFlagCachePort.findSlot` replaced `tryGet`; any process-side cache double follows.

## Data-retention (from the lane report)

`installApiDataRetention({ infrastructure, peers: { projects, organizations, permissions, users }, defaultRetentionDays, redis, resolveClickHouseClient })`
in `apps/api/src/features/data-retention/data-retention.composition.ts` is async and returns
`ComposedDataRetentionFeature` (`service: DataRetentionApi` — the field name `service` is kept on
purpose, `router(mount)`). No refusing twin.

1. `apps/api/src/app/api-production.composition.ts` — the import block
   (`composeDataRetentionFeature`, `LoggedApiDataRetentionAbsence`, `refusingDataRetentionFeature`)
   becomes `installApiDataRetention`; `composeDataRetention` takes a non-optional `infrastructure`,
   returns the promise of `installApiDataRetention({ infrastructure, peers: { projects: this.composedProject.app, organizations: this.composedOrganization.app, permissions: this.composedAuthz.app, users: this.composedUser.app }, defaultRetentionDays: options.config.platformDefaultRetentionDays, redis: queueInfrastructure?.redis ?? null, resolveClickHouseClient: this.composedClickHouse?.resolveClient ?? null })`.
   **Ordering:** the call must move after `composeTenantFeatures` (project and organization apps are
   assigned there) and be awaited, and the share install that reads
   `this.composedDataRetention.service` moves with it; the `infrastructure` guard moves to the call
   site. Readers of `.service` need no edit.
2. Test doubles `dataRetention: refusingDataRetentionFeature()` in `app/__tests__/api-trpc-record.test-doubles.ts`,
   `app-trpc/__tests__/support/app-trpc-features.ts`,
   `features/gateway/__tests__/gateway.composition.integration.test.ts` become
   `{ router: (mount) => createDataRetentionTrpcRouter(mount.runtime), service: createApiFixture<DataRetentionApi>() }`.
   `features/stored-object/__tests__/product-storage.composition.integration.test.ts` calls
   `composeDataRetentionFeature({...})`: becomes `await installApiDataRetention({...})` with the four
   peers; the wire names it drives are unchanged.
3. `apps/api/src/app-trpc/index.ts` re-exports `createDataRetentionTrpcRouter`, whose signature is now
   `(runtime: TrpcRuntime<TContext>)`; callers outside the feature folder take that form.
4. **Worker.** `apps/worker/src/app/worker-foundation-apps.composition.ts`: the builder gains
   `.withPersistence("postgres", { prisma: options.connection.client })` (share, api-key and authz
   already need it); the `dataRetention` infrastructure literal gains
   `directory: PrismaDataRetentionDirectoryRepository.create(options.connection.client)` and
   `plans: WorkerDataRetentionPlans.create(options.plans)`. `worker-tenancy.composition.ts` drops the
   `database` key from the `withFeature(dataRetentionServer, …)` literal. `WorkerDataRetentionPlans
   extends DataRetentionPlanPort` lives in `worker-tenancy-infrastructure.composition.ts`:
   `getPlan({ organizationId, userId })` calls `plans.getActivePlan({ organizationId, ...(userId ? { user: { id: userId } } : {}) })`
   and answers `{ free: plan.free, uncapped: isEnterpriseTier(plan.type) }` (`@langwatch/enterprise-plan-gate`
   is already a worker dependency).
5. `DataRetentionService` is a banned compatibility alias still exported by the contract index; ten
   files in `apps/api`, `packages/features/trace` and `packages/enterprise` name it. Rename those to
   `DataRetentionApi` and delete the alias from
   `packages/features/data-retention/contract/src/index.ts` (that one file is allowed).
6. Known and not yours: `tryGetPin` keeps its prefix because share calls it; the
   `private-runtime-export` on the directory repository stays open (both processes build the directory
   from it); the plan gate stays a port because the worker foundation has no `EntitlementApi`.

## Rules for the lane

Opus. Read, Edit, Write only; change only the named lines in files that carry other lanes' hunks.
Allowed: the files named above, `apps/api/src/features/{secret,feature-flag,data-retention}/__tests__/**`
for new composition tests, `apps/worker/src/app/**` for the worker boot. Never `packages/api/**`, any
`*-baseline.json`, `.env*`. No git writes. No re-exports, no `as unknown as`, no `try*`, no inline
`import()`. `apps/api/src/app` is over the folder budget: add no file there.

When done, for EVERY file you edited run `git diff HEAD -- <file>`; where any hunk is not yours, write a
HEAD-based variant (take `git show HEAD:<path>`, re-apply only your edits with the Edit tool) to
`/Users/afr/.claude/jobs/eeb488e6/tmp/blobs-wiring2/<repo-relative path>` (mkdir -p). The commit takes
the variant; the working copy keeps everyone's hunks.

## Report

1. Files touched, repo-relative, one per line, each marked `own`, `variant` or `new`.
2. The composition-order change in `api-production.composition.ts`, in five lines.
3. Typecheck totals for api and worker, the count in files you touched (zero), and every error line
   naming one of the three features (none); show the filter.
4. Test output for the files you touched, verbatim.
5. What the feature lanes' reports got wrong about the process.
