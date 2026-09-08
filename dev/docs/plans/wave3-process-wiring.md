# Wave-3 process wiring: topic, then sso and data-privacy

**Date:** 2026-09-08 · **Owner lane:** one Opus agent, after the wave-2 wiring lane leaves
`apps/api/src/app/api-production.composition.ts` · **Reviewed by:** Fable

Same rules as `wave2-process-wiring.md`: Read/Edit/Write only, no git writes, no baselines, no root
typecheck/lint/format, ONE `tsc --noEmit -p apps/api/tsconfig.test.json` (and one for
`apps/worker/tsconfig.test.json`) as oracle filtered to touched files, HEAD-variant blobs for files
carrying other lanes' hunks written to the blob directory Fable names in the launch prompt.

## topic (feature landed `a8508cf3c7`)

`TopicService` → `TopicApi` (type only, member list identical); `ComposedTopicFeature.service` → `.app`;
`composeTopicFeature`/`refusingTopicFeature` → `installApiTopic({ infrastructure })` (async);
`TopicInfrastructure` lost `database` (persistence is chosen at boot).

Type rename `TopicService` → `TopicApi`:
- `apps/api/src/app-trpc/app-trpc.context.ts` (import + `topics: TopicApi;`)
- `apps/api/src/app/api-trace-read-stack.composition.ts`
- `apps/api/src/features/trace/trace.composition.ts`
- `apps/api/src/features/organization/__tests__/tenant-features.composition.integration.test.ts`
- `apps/worker/src/app/worker-report-schedule.composition.ts` (`refuseReportRead<TopicApi>`)
- `packages/features/trace/server/src/services/trace-topic-naming.service.ts`
- `packages/features/trace/server/src/services/trace-list-read.service.ts`

`apps/api/src/index.ts`: export `installApiTopic` instead of `composeTopicFeature, refusingTopicFeature`.

`apps/api/src/app/api-production.composition.ts` (match on text, the file moves):
- import `installApiTopic`; `private composedTopic: ComposedTopicFeature | undefined;`
- `this.composedTopic = infrastructure ? await installApiTopic({ infrastructure }) : undefined;`
- tRPC-record block: `const topic = this.composedTopic;` beside `const share = ...`; add `|| !topic` to the
  refusing guard and `&& topic` to the `features` conjunction; `topic: this.composedTopic,` → `topic,`;
  `topics: this.composedTopic.service,` → `topics: topic.app,`.
- `composeTrace`: same local, guard gains `|| !topic`, both `this.composedTopic.service` → `topic.app`.
- organization/project block: same local, guard gains `|| !topic`, `topics: topic.app,`.

Test doubles: `apps/api/src/app/__tests__/api-trpc-record.test-doubles.ts` drops `refusingTopicFeature`,
adds `stubTopicFeature()` (`{ app: stub("topic"), router: (mount) => createTopicTrpcRouter(mount.runtime) }`
with `createTopicTrpcRouter` from `apps/api/src/features/topic/topic-trpc.mount.ts` and the type from
`topic.composition.types.ts`) and uses it; `apps/api/src/app-trpc/__tests__/support/app-trpc-features.ts` and
`apps/api/src/features/gateway/__tests__/gateway.composition.integration.test.ts` import the stub the same way
the share/presence stubs are imported.

Worker: `apps/worker/src/app/worker-tenancy.composition.ts` `.withFeature(topicServer, { infrastructure:
options.topics })` (no `database`); `Omit<TopicInfrastructure, "database">` in that file and
`worker-tenancy-infrastructure.composition.ts` becomes plain `TopicInfrastructure`.
**Prerequisite:** `apps/worker/src/app/worker-foundation-apps.composition.ts` builds
`createApp({ name: "langwatch-worker-foundation" }).withInfrastructure({})` with no persistence; boot refuses a
`withRepositories` feature there. Add `.withPersistence("postgres", { prisma: options.connection.client })`
(share already needs it). Same for the test builders in
`apps/worker/src/app/__tests__/worker-tenancy.composition.unit.test.ts` and
`apps/worker/src/__tests__/codex-coding-defaults.integration.test.ts`.

No change: `app-trpc/index.ts`, `app-trpc.composed.ts`, `app-trpc.features.ts` (`router` kept its signature).

Follow-ups outside this lane: `TopicClusteringSchedulePort.tryGetNextWakeAt` and the clustering repository's
`tryFindProject`/`tryFindTopicModelCursor`/`tryLoad` still trip `fallible-result-naming` (reach apps/worker
tests); `guardOutput` now always validates outputs where the old mount honoured `validateOutput`.

## sso (feature landed `c1363cbb99`)

`SsoGate`/`SsoService` → `SsoApi` (`@langwatch/enterprise-sso-contract`); the back-office procedures leave
`enterprise-trpc.composition.ts` and are mounted by `apps/api/src/features/sso/sso-trpc.mount.ts` (imports
`ssoConnectionTrpcTransport` and `type SsoApi` from `@langwatch/enterprise-api`, because `enterprise-direction`
forbids apps/api depending on an Enterprise feature server); `EnterpriseApiSso` in
`packages/enterprise/composition/api/src/sso.composition.ts` boots the feature.

1. `packages/enterprise/composition/api/package.json` gains `@langwatch/ops-contract` and `@langwatch/user-contract`
   (`workspace:*`) plus the matching `tsconfig.json`/`tsconfig.build.json` references.
2. `packages/enterprise/composition/api/src/index.ts`: delete the `SsoGate` import, the `sso?: SsoGate` option and the
   constructor slot (dead: only `tests/api-composition.unit.test.ts` constructs it — fix that test); add
   `export { EnterpriseApiSso, type EnterpriseApiSsoPeers } from "./sso.composition.ts";`,
   `export { ssoConnectionTrpcTransport, SsoConnectionLedgerPort, SsoGateLoggerPort, type SsoInfrastructure } from
   "@langwatch/enterprise-sso-server";`, `export { SsoApi, ssoConfigurationSchema, type SsoConfiguration } from
   "@langwatch/enterprise-sso-contract";` beside the `auditLogServer` block.
3. `packages/enterprise/composition/api/src/trpc/enterprise-trpc.composition.ts`: remove the sso half — the
   `SsoConnectionTrpcApi`/`SsoConnectionTrpcContext`/`SsoConnectionTrpcPorts` import, `SsoConnectionTrpcContext &` from
   `EnterpriseTrpcContext`, `BACK_OFFICE_NO_PERMISSION*` (now `STAFF_LIST_REASON`/`ORGANIZATION_IS_ROUTING` in the
   feature's transport), the `TSsoConnectionPorts` generic, the `backOfficePolicy*` options, `ports.ssoConnections`,
   the `SsoConnectionTrpcApi.create(...)` block and `ssoConnections,` in the returned record.
4. `apps/api/src/features/enterprise/enterprise-trpc.mount.ts`: drop the two `BACK_OFFICE_*` imports and options;
   destructure and return `{ license, licenseEnforcement, scimToken }` only.
5. `apps/api/src/features/enterprise/enterprise.composition.ts`: keep `ApiEnterpriseApplicationPort.backoffice` retyped
   to `(() => SsoConnectionLedgerPort) | undefined`; delete the `ssoConnections` key from `composeEnterpriseMountPorts`
   and `refusingEnterpriseFeature`, and `unavailableSsoBackoffice()` once step 8 supplies the refusing ledger; check
   whether the `audit` option is still read before deleting it.
6. `apps/api/src/app/api-enterprise-application.composition.ts`: `ApiSsoConnectionBackoffice` → `SsoConnectionLedgerPort`
   from `@langwatch/enterprise-api`; in `asBackofficePort` the one verb rename `getById:` → `findById: (input) =>
   service.tryGetById(input)` (docblock updated); drop the unused `EnterpriseTrpcMountPorts` import.
7. `apps/api/src/app-trpc/app-trpc.context.ts`: `ApiTrpcFeatureApplication.sso: SsoApi` (type from `@langwatch/enterprise-api`).
8. `apps/api/src/app/api-production.composition.ts`: `const sso = await EnterpriseApiSso.create({ configuration: { isSaas,
   provider: authProvider ?? "email", baseUrl: configuration.baseUrl }, connections: enterprise.backoffice?.() ??
   <refusing ledger>, logger: <SsoGateLoggerPort over createLogger("langwatch:api:sso")>, peers: { licensing, operators:
   opsApp, users: userApp, auditLog } })`; `app.sso = sso.sso()`; stop on shutdown. No credential reads: this process
   passes none today (`api-better-auth.composition.ts` mounts no providers), so `providerIsMounted()` stays false and
   `resolveProvider()` stays `"email"`. The refusing ledger is the old `unavailableSsoBackoffice()` behaviour (every verb
   throws `ApiEnterpriseUnavailableError("Enterprise single sign-on ledger, so it can neither read nor command a
   connection")`), typed, in `apps/api/src/features/sso/` beside the mount.
9. `apps/api/src/app-trpc/app-trpc.features.ts`: `ssoConnections: createSsoConnectionTrpcRouter(mount.runtime)`.
10. Tests naming `ssoConnections`: `api-trpc-features.composition.integration.test.ts:243`,
    `api-trpc-record.integration.test.ts:108`, `api-enterprise-application.composition.unit.test.ts:206`,
    `organization/__tests__/tenant-features.composition.integration.test.ts:48`,
    `app-trpc/__tests__/app-trpc.features.unit.test.ts:112`.

Follow-ups outside this lane: `packages/features/ops/web/src/behavior/ops-api.ts:581` hand-writes the `ssoConnections`
map (→ `ContractApiMap<typeof ssoConnectionTrpc>`); `SsoConnectionLedgerPort` becomes an identity peer once identity
has an API token; `authenticated_actor_required` sits on `UNCOPIED_CODES_BACKLOG` in
`apps/ui/src/model/errors/__tests__/codes.unit.test.ts` and wants presentation copy.

## Files on yesterday's uncommitted pile

`apps/worker/src/app/worker-tenancy.composition.ts` and `apps/worker/src/__tests__/codex-coding-defaults.integration.test.ts`
carry a large uncommitted rewrite from the stopped 09-07 lane, so no HEAD variant is possible for them. Edit them in
place and list them under "manual pick" in the report; do not write a blob for them. The wave-2 lane's own edits there
(data-retention `redis`, `.withPersistence("postgres", …)`, `await createWorkerScenarioExecutionGraph`) are already in
the working copy and stay.

## data-privacy (feature landed `77f4346117`)

`DataPrivacyService` → `DataPrivacyApi`; `composeDataPrivacyFeature`/`refusingDataPrivacyFeature` →
`await installApiDataPrivacy({ infrastructure, peers: { projects, organizations, permissions } })`;
`ComposedDataPrivacyFeature.service` → `.app`; `dropsAnyContent(projectId)` → `app.dropsAnyContent({ projectId })`;
`DataPrivacyInfrastructure` is `{ directory, ttlMs?, now? } & ({ redaction: … | null } | { pii })` — the API passes
`redaction: null`, the worker passes its `pii` block. `PrismaDataPrivacyResolutionAdapter`, `PrismaDataPrivacyAdapter`,
`DataPrivacyPermissionsPort`, `@langwatch/data-privacy-server/testing` are gone.

`apps/api/src/app/api-production.composition.ts`: import `installApiDataPrivacy`; field `ComposedDataPrivacyFeature |
undefined`; compose `infrastructure ? await installApiDataPrivacy({ infrastructure, peers: { projects:
tenancy.projects, organizations: tenancy.organizations, permissions: this.composedAuthz.app } }) : undefined`; join the
no-refusing-twin guard (`const dataPrivacy = this.composedDataPrivacy;`, `|| !dataPrivacy`, `&& dataPrivacy`,
`dataPrivacy,` in the composed literal); `collaborators.application` gains `dataPrivacy: dataPrivacy.app,`;
`hasContentDropRules: (projectId) => dataPrivacy.app.dropsAnyContent({ projectId })`; the trace-read stack takes
`this.composedDataPrivacy.app`.

`apps/api/src/app-trpc/app-trpc.context.ts`: `ApiTrpcFeatureApplication.dataPrivacy: DataPrivacyApi` (import type from
`@langwatch/data-privacy-contract`). `apps/api/src/app/api-trace-read-stack.composition.ts`: `DataPrivacyService` →
`DataPrivacyApi` (two sites). `apps/api/src/features/analytics/analytics.composition.ts`: drop the
`PrismaDataPrivacyResolutionAdapter.create(...)` at ~line 188 and thread the booted `DataPrivacyApi` in (the consumer type
is already `{ getResolvedForProject }`). Test doubles: `api-trpc-record.test-doubles.ts` drops
`refusingDataPrivacyFeature` and the `dataPrivacy:` stub entry; `stubApplicationSlices` gains `dataPrivacy`.

Worker: `apps/worker/src/app/worker-telemetry-read.composition.ts` — `database: DataPrivacyDirectoryDatabase` and
`dataPrivacy: { directory: PrismaDataPrivacyDirectoryRepository.create(options.database), pii: {…unchanged} }`.
`apps/worker/src/app/worker-trace-capability-services.composition.ts` — take `dataPrivacy: DataPrivacyResolutionPort`
as an option instead of building the deleted adapter (drop `dataPrivacyTtlMs`, the `& DataPrivacyResolutionDatabase`
term); caller `worker-production.composition.ts` ~line 726 passes the booted app (`observability.dataPrivacy`) — the
observability runtime must boot first, or the argument is `() => DataPrivacyApi`; eight worker tests pass `{ database }`
today and each needs a `dataPrivacy` stub (`worker-trace-capability-services.composition.unit.test.ts` ×7,
`worker-trace-processing-mount`, `worker-record-span`, `worker-automation-graph`).
`worker-automation-settlement-reads.composition.ts:20` moves from `DataRetentionResolutionService` to
`DataPrivacyResolutionPort`.

Decision for Alex recorded: nullable `redaction` in the API vs a record-redaction port owned by log and metric.
