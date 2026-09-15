## billing (from fold-billing report, 06:5x) - needs api-production.composition.ts (held by apply-handovers until it reports), api-billing-webhook.composition.ts, worker-production.composition.ts, apps/tasks/src/tasks.catalogue.ts
import { PostgresBillingRepositories } from "@langwatch/enterprise-billing-server";
api-billing-webhook.composition.ts L206: const repositories = PostgresBillingRepositories.create({ prisma }); L226-231 subscriptionRepository: repositories.webhookSubscriptions, organizationRepository: repositories.webhookOrganizations; drop 3 names from import L33-35
api-production.composition.ts L63 import; L4210 subscriptions: PostgresBillingRepositories.create({ prisma: database.client }).subscriptions,
worker-production.composition.ts L594-595 subscriptions: ...create({ prisma: options.connection.client }).subscriptions; L1509-1511 const billingRows = ...create({ prisma: options.database }); L1526 organizations: billingRows.reportOrganizations, L1527 billingCheckpoints: billingRows.checkpoints; L2170-2172 organizations: ...create({ prisma: options.database }).tenantOrganizations; imports L77,78,83 drop
apps/tasks/src/tasks.catalogue.ts L77 PostgresBillingRepositories.create({ prisma: host.requirePrisma() }).duplicateSubscriptionsReports; import L15
then delete enterprise/modules/billing/server/src/adapters/postgres.*.adapter.ts (5) + 2 webhook factories; closes billing|persistence-adapter
## stored-object (from fold-stored-object report)
worker-object-storage.composition.ts + its unit test: S3PayloadStagingAdapter -> PayloadStagingS3Repository, AzureBlobStoredObjectDriverAdapter -> StoredObjectBlobAzureRepository; apps/tasks/src/platform/object-storage-migrate.composition.ts: MigrationS3StorageDriverAdapter -> MigrationBlobS3Repository; type StoredObjectStorageDriver -> StoredObjectBlobRepository(+Factory) in api-trace-spool test, worker-stored-object-storage.adapter.ts, worker-object-storage.composition.ts; then rename in module repositories/** and index.ts same step
## automation step 7 (plan-automation.md lines 419-613): worker-automation-graph, worker-automation-settlement, worker-report-schedule, worker-production; then step 8 deletes the four shims

## langy tokenBuffer (reported 05:2x)
- api-production.composition.ts:2885 `LangyTokenBufferRedisRepository.create({ redis })` -> `repositories.tokenBuffer.open({ redis })` (needs composeLangy's repositories in scope)
- api-production.composition.ts:3895 `buffer: LangyTokenBufferRedisRepository.create({ redis: this.composedQueueRedis as NonNullable<...> })` -> `buffer: repositories.tokenBuffer.open({ redis: this.composedQueueRedis })`
- worker-langy-conversation.composition.ts:83 candidate only (no LangyRepositories built there)
- follow-up in apps/api/src/features/langy: langy-rest.mount.ts turns.openTurnBuffer, langy.composition.ts turns.tokenBuffer still call .create directly

## identity (steps 0-4 landed; Q3(c) ruled: ssoConnectionLedger nullable like mail, IdentityApp refuses by name when absent; composeBackoffice in api-enterprise-application.composition.ts joins the step 6/7 repoint list)

## door langwatch-ql (reported 07:3x) - api-rest.doors.ts held by Codex (file dirty in tree)
import { mountLangWatchQLRest } from "../features/analytics/langwatch-ql-rest.mount.ts";
entry: add to `family: "langwatch-ql"`:
    mount: ({ runtime, services }: ApiRestDoorContext) =>
      services.langWatchQL
        ? [mountLangWatchQLRest(runtime, { collaborators: services.langWatchQL.collaborators, dashboard: services.langWatchQL.dashboard, publicBaseUrl: services.publicBaseUrl })]
        : null,
api-production: no change (services.langWatchQL and publicBaseUrl already composed).
Follow-up door: query-rest.mount.ts still dead (createQueryRestApp/AppRestSecurity).
