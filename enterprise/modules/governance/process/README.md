# @langwatch/enterprise-governance-process

The server half of [governance](../README.md). AI governance: ingestion sources and pulls, cost attribution, anomaly rules and alerts, tool and session policies, departments, and the CLI's budget and virtual-key reads.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("governance").withRepositories(governanceRepositories).withApi(GovernanceModule).withTransports(governanceRest, governanceCliRest, governanceIngestRest, meUsageRest, departmentsTrpcTransport, ingestionTemplatesTrpcTransport, aiToolsTrpcTransport, ingestionSourcesTrpcTransport, governanceTrpcTransport, anomalyRulesTrpcTransport, activityMonitorTrpcTransport, personalSessionsTrpcTransport, ingestionKeyTrpcTransport, sessionPolicyTrpcTransport, governancePeopleTrpcTransport, governanceAgentsTrpcTransport, governanceCostTrpcTransport).withTransportFacts(…).withEventing(pulledUsageEventing).withEventing(ingestionPullEventing).withEventing(ingestionPullReconcileEventing).withEventing(governanceActivityMonitorEventing).withEventing(codingAssistantBillingEventing).withMigrations(…)`, `src/governance.module.ts:54`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`GovernanceRestApi`)

The ingestion-template operations the governance REST family calls.

Peers call these through the token, declared at `../contract/src/governance.api.ts:168`; nothing else in this package is public.

#### `registerMcpTools`

Installs the governance MCP tools on one hosted MCP session (Alex, 2026-09-27).

```typescript
registerMcpTools(input: GovernanceMcpSessionTools): void;
```

#### `cliBudgetStatus`

```typescript
cliBudgetStatus(input: GovernanceCliRequest): Promise<GovernanceCliBudgetStatusAnswer>;
```

#### `cliBootstrapRead`

```typescript
cliBootstrapRead(input: GovernanceCliRequest): Promise<GovernanceCliBootstrapAnswer>;
```

#### `cliBudgetOverview`

```typescript
cliBudgetOverview(input: GovernanceCliRequest): Promise<GovernanceCliBudgetOverviewAnswer>;
```

#### `cliPersonalProject`

```typescript
cliPersonalProject(input: GovernanceCliRequest): Promise<GovernanceCliPersonalProjectAnswer>;
```

#### `cliVirtualKey`

```typescript
cliVirtualKey(input: GovernanceCliRawRequest): Promise<GovernanceCliVirtualKeyAnswer>;
```

#### `cliIngestionSources`

```typescript
cliIngestionSources(input: GovernanceCliSourcesRequest): Promise<GovernanceCliIngestionSourcesAnswer>;
```

#### `cliIngestionSourceEvents`

```typescript
cliIngestionSourceEvents(input: GovernanceCliSourceEventsRequest): Promise<GovernanceCliIngestionSourceEventsAnswer>;
```

#### `cliIngestionSourceHealth`

```typescript
cliIngestionSourceHealth(input: GovernanceCliSourceRequest): Promise<GovernanceCliIngestionSourceHealthAnswer>;
```

#### `cliGovernanceStatus`

```typescript
cliGovernanceStatus(input: GovernanceCliRequest): Promise<GovernanceCliGovernanceStatusAnswer>;
```

#### `cliIngestionTemplates`

```typescript
cliIngestionTemplates(input: GovernanceCliRequest): Promise<GovernanceCliIngestionTemplatesAnswer>;
```

#### `cliIngestionKey`

```typescript
cliIngestionKey(input: GovernanceCliRawRequest): Promise<GovernanceCliIngestionKeyAnswer>;
```

#### `cliIngestionKeys`

```typescript
cliIngestionKeys(input: GovernanceCliRequest): Promise<GovernanceCliIngestionKeysAnswer>;
```

#### `cliIngestionKeyState`

```typescript
cliIngestionKeyState(input: GovernanceCliKeyLookupRequest): Promise<GovernanceCliIngestionKeyStateAnswer>;
```

#### `ingestOtlpTraces`

```typescript
ingestOtlpTraces(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse>;
```

#### `ingestWebhook`

```typescript
ingestWebhook(input: GovernanceIngestWebhookInput): Promise<GovernanceIngestResponse>;
```

#### `ingestOtlpLogs`

```typescript
ingestOtlpLogs(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse>;
```

#### `ingestOtlpMetrics`

```typescript
ingestOtlpMetrics(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse>;
```

#### `isSourceBilled`

```typescript
isSourceBilled(input: { organizationId: string; sourceType: string }): Promise<boolean>;
```

#### `listIngestionTemplatesForMember`

```typescript
listIngestionTemplatesForMember(scope: { projectId: string }): Promise<IngestionTemplate[]>;
```

#### `listIngestionTemplatesForAdmin`

```typescript
listIngestionTemplatesForAdmin(scope: { projectId: string }): Promise<IngestionTemplate[]>;
```

#### `getIngestionTemplate`

```typescript
getIngestionTemplate(input: { projectId: string; id: string }): Promise<IngestionTemplate>;
```

#### `createIngestionTemplate`

```typescript
createIngestionTemplate(input: GovernanceTemplateDraft, by: GovernanceProjectCaller): Promise<IngestionTemplate>;
```

#### `updateIngestionTemplateOttlRules`

```typescript
updateIngestionTemplateOttlRules(input: { id: string; ottlRules: string }, by: GovernanceProjectCaller): Promise<IngestionTemplate>;
```

#### `archiveIngestionTemplate`

```typescript
archiveIngestionTemplate(input: { id: string }, by: GovernanceProjectCaller): Promise<void>;
```

#### `cloneIngestionTemplate`

```typescript
cloneIngestionTemplate(input: { sourceTemplateId: string }, by: GovernanceProjectCaller): Promise<IngestionTemplate>;
```

#### `anomalyRuleList`

```typescript
anomalyRuleList(input: { organizationId: string }, by: EntitlementOperator): Promise<AnomalyRule[]>;
```

#### `anomalyRuleGetById`

```typescript
anomalyRuleGetById(input: { id: string; organizationId: string }, by: EntitlementOperator): Promise<AnomalyRule>;
```

#### `anomalyRuleCreate`

```typescript
anomalyRuleCreate(input: CreateAnomalyRuleInput, by: EntitlementOperator): Promise<AnomalyRule>;
```

#### `anomalyRuleUpdate`

```typescript
anomalyRuleUpdate(input: UpdateAnomalyRuleInput, by: EntitlementOperator): Promise<AnomalyRule>;
```

#### `anomalyRuleArchive`

```typescript
anomalyRuleArchive(input: { id: string; organizationId: string }, by: EntitlementOperator): Promise<AnomalyRule>;
```

#### `activitySummary`

```typescript
activitySummary(input: ActivityMonitorWindowQuery, by: EntitlementOperator): Promise<ActivityMonitorSummary>;
```

#### `activitySpendByUser`

```typescript
activitySpendByUser(input: ActivityMonitorPagedWindowQuery, by: EntitlementOperator): Promise<SpendByUserRow[]>;
```

#### `activitySpendByTeam`

```typescript
activitySpendByTeam(input: ActivityMonitorPagedWindowQuery, by: EntitlementOperator): Promise<SpendByTeamRow[]>;
```

#### `activitySpendByDepartment`

```typescript
activitySpendByDepartment(input: ActivityMonitorWindowQuery, by: EntitlementOperator): Promise<SpendByDepartmentRow[]>;
```

#### `activitySpendOverTime`

```typescript
activitySpendOverTime(input: ActivityMonitorWindowQuery & { groupBy: SpendOverTimeGroupBy }, by: EntitlementOperator): Promise<SpendOverTimeResult>;
```

#### `activityRecentAnomalies`

```typescript
activityRecentAnomalies(input: { organizationId: string; limit: number }, by: EntitlementOperator): Promise<RecentAnomalyRow[]>;
```

#### `activityIngestionSourcesHealth`

```typescript
activityIngestionSourcesHealth(input: { organizationId: string }, by: EntitlementOperator): Promise<IngestionSourceHealthRow[]>;
```

#### `activityEventsForSource`

```typescript
activityEventsForSource(input: { organizationId: string; sourceId: string; limit: number; beforeIso?: string }, by: EntitlementOperator): Promise<ActivityEventDetailRow[]>;
```

#### `activitySourceHealthMetrics`

```typescript
activitySourceHealthMetrics(input: { organizationId: string; sourceId: string }, by: EntitlementOperator): Promise<SourceHealthMetrics>;
```

#### `aiToolListForUser`

```typescript
aiToolListForUser(input: AiToolMemberInput): Promise<AiToolEntry[]>;
```

#### `aiToolProviderAvailability`

```typescript
aiToolProviderAvailability(input: AiToolMemberInput): Promise<{ configuredProviders: string[] }>;
```

#### `aiToolClaudeCodeOtlpEndpoint`

```typescript
aiToolClaudeCodeOtlpEndpoint(input: AiToolOrganizationInput): Promise<{ endpoint: string | null }>;
```

#### `aiToolListForAdmin`

```typescript
aiToolListForAdmin(input: AiToolOrganizationInput): Promise<AiToolEntry[]>;
```

#### `aiToolGetById`

```typescript
aiToolGetById(input: FindAiToolEntryInput): Promise<AiToolEntry>;
```

#### `aiToolCreate`

```typescript
aiToolCreate(input: CreateAiToolEntryInput): Promise<AiToolEntry>;
```

#### `aiToolUpdate`

```typescript
aiToolUpdate(input: UpdateAiToolEntryInput): Promise<AiToolEntry>;
```

#### `aiToolRemove`

```typescript
aiToolRemove(input: FindAiToolEntryInput): Promise<AiToolEntry>;
```

#### `aiToolSeedStarterPack`

```typescript
aiToolSeedStarterPack(input: SeedAiToolStarterPackInput): Promise<{ created: number; updated: number; skipped: number }>;
```

#### `aiToolEnsureDefaultCatalog`

Main's `ensureDefaultCatalog`: the starter set, only for an organization with no entries.

```typescript
aiToolEnsureDefaultCatalog(input: AiToolOrganizationInput): Promise<{ hasSeeded: boolean; created: number }>;
```

#### `aiToolStarterPackCatalog`

```typescript
aiToolStarterPackCatalog(): AiToolStarterTileChoice[];
```

#### `aiToolListProviderOptionsForAdmin`

```typescript
aiToolListProviderOptionsForAdmin(input: AiToolOrganizationInput): Promise<AiToolProviderOption[]>;
```

#### `aiToolListRoutingPolicyOptionsForAdmin`

```typescript
aiToolListRoutingPolicyOptionsForAdmin(input: AiToolOrganizationInput): Promise<{ id: string; name: string }[]>;
```

#### `aiToolReorder`

```typescript
aiToolReorder(input: ReorderAiToolEntriesInput): Promise<void>;
```

#### `templateListForUser`

```typescript
templateListForUser(input: { organizationId: string }): Promise<IngestionTemplate[]>;
```

#### `templateListForOrgAdmin`

```typescript
templateListForOrgAdmin(input: { organizationId: string }): Promise<IngestionTemplate[]>;
```

#### `templateGetByIdForOrg`

```typescript
templateGetByIdForOrg(input: { id: string; organizationId: string }): Promise<IngestionTemplate>;
```

#### `templateCreateOrg`

```typescript
templateCreateOrg(input: CreateIngestionTemplateInput): Promise<IngestionTemplate>;
```

#### `templateUpdateOttlRules`

```typescript
templateUpdateOttlRules(input: UpdateIngestionTemplateOttlInput): Promise<IngestionTemplate>;
```

#### `templateArchiveOrg`

```typescript
templateArchiveOrg(input: ArchiveIngestionTemplateInput): Promise<void>;
```

#### `templateCloneFromPlatform`

```typescript
templateCloneFromPlatform(input: CloneIngestionTemplateInput): Promise<IngestionTemplate>;
```

#### `ingestionKeyList`

```typescript
ingestionKeyList(input: { organizationId: string; userId: string; }): Promise<PersonalIngestionKeyListing[]>;
```

#### `ingestionKeyInstall`

No key is minted while an impersonator acts as the member.

```typescript
ingestionKeyInstall(input: PersonalIngestionKeyMint & { impersonatorId?: string | undefined }): Promise<IssuedIngestionKey>;
```

#### `ingestionKeyRotate`

```typescript
ingestionKeyRotate(input: PersonalIngestionKeyMint & { impersonatorId?: string | undefined }): Promise<RotatedIngestionKey>;
```

#### `ingestionKeyRevoke`

```typescript
ingestionKeyRevoke(input: { organizationId: string; userId: string; apiKeyId: string; surface?: GovernanceCallSurface; }): Promise<void>;
```

#### `sessionPolicyGet`

```typescript
sessionPolicyGet(input: { organizationId: string }): Promise<OrganizationSessionPolicyShape>;
```

#### `sessionPolicySetMaxDuration`

```typescript
sessionPolicySetMaxDuration(input: { organizationId: string; maxSessionDurationDays: number; }): Promise<SessionCeilingApplied>;
```

#### `governanceAgentsSyncSources`

```typescript
governanceAgentsSyncSources(input: { organizationId: string }): Promise<AgentSyncSourceListing[]>;
```

#### `governanceAgentsRequestListing`

```typescript
governanceAgentsRequestListing(input: { organizationId: string; }): Promise<AgentListingRequestResult>;
```

#### `governanceAgentsList`

```typescript
governanceAgentsList(input: { organizationId: string }): Promise<GovernanceAgentRow[]>;
```

#### `governanceCostSummary`

```typescript
governanceCostSummary(input: GovernanceCostWindowInput, by: EntitlementOperator): Promise<GovernanceCostSummary>;
```

#### `governanceCostDailyByProvider`

```typescript
governanceCostDailyByProvider(input: GovernanceCostWindowInput, by: EntitlementOperator): Promise<GovernanceCostProviderDayBreakdown>;
```

#### `governanceCostSpendByModel`

```typescript
governanceCostSpendByModel(input: GovernanceCostWindowInput, by: EntitlementOperator): Promise<GovernanceCostModelBreakdown>;
```

#### `governanceCostPeriodRecords`

```typescript
governanceCostPeriodRecords(input: GovernanceCostPeriodRecordsInput, by: EntitlementOperator): Promise<GovernanceCostDayRecords>;
```

#### `governanceCostSpenders`

```typescript
governanceCostSpenders(input: GovernanceCostWindowInput, by: EntitlementOperator): Promise<GovernanceSpenderBreakdown>;
```

#### `governancePeopleList`

```typescript
governancePeopleList(input: { organizationId: string }): Promise<PeopleScreenPerson[]>;
```

#### `governancePeopleSuggestions`

```typescript
governancePeopleSuggestions(input: { organizationId: string }): Promise<PeopleScreenSuggestion[]>;
```

#### `governancePeopleRunMatch`

```typescript
governancePeopleRunMatch(input: { organizationId: string }): Promise<IdentityMatchRun>;
```

#### `governancePeopleConfirmSuggestion`

```typescript
governancePeopleConfirmSuggestion(input: { organizationId: string; suggestionId: string; }): Promise<IdentityMatchConfirmed>;
```

#### `cliSessionListForUser`

```typescript
cliSessionListForUser(input: CliUserInput): Promise<CliSessionCard[]>;
```

#### `cliSessionRevoke`

```typescript
cliSessionRevoke(input: RevokeCliSessionInput): Promise<CliSessionRevocation>;
```

#### `cliSessionRevokeAll`

```typescript
cliSessionRevokeAll(input: CliUserInput): Promise<CliSessionRevocation>;
```

#### `personalWebSessionList`

```typescript
personalWebSessionList(input: { userId: string; currentSessionId?: string | undefined; }): Promise<BrowserSessionInventoryEntry[]>;
```

#### `personalWebSessionEnd`

```typescript
personalWebSessionEnd(input: { userId: string; sessionId: string; currentSessionId?: string | undefined; }): Promise<{ ended: number }>;
```

#### `personalWebSessionsEndForIdentifier`

```typescript
personalWebSessionsEndForIdentifier(input: { userId: string; identifierId: string; }): Promise<{ ended: number }>;
```

#### `ingestionSourceList`

```typescript
ingestionSourceList(input: { organizationId: string }): Promise<IngestionSourceDto[]>;
```

#### `ingestionSourceGet`

```typescript
ingestionSourceGet(input: { id: string; organizationId: string }): Promise<IngestionSourceDto>;
```

#### `ingestionSourceCreate`

```typescript
ingestionSourceCreate(input: IngestionSourceCreateInput & { actorUserId: string }): Promise<{ source: IngestionSourceDto; ingestSecret: string | null }>;
```

#### `ingestionSourceUpdate`

```typescript
ingestionSourceUpdate(input: IngestionSourceUpdateInput): Promise<IngestionSourceDto>;
```

#### `ingestionSourceRotateSecret`

```typescript
ingestionSourceRotateSecret(input: { id: string; organizationId: string; /** A session's impersonator: no secret is minted while one acts as a member. */ impersonatorId?: string | undefined; }): Promise<{ source: IngestionSourceDto; ingestSecret: string }>;
```

#### `ingestionSourceArchive`

```typescript
ingestionSourceArchive(input: { id: string; organizationId: string; }): Promise<IngestionSourceDto>;
```

#### `ingestionSourceValidateOttl`

```typescript
ingestionSourceValidateOttl(input: { statements: string[] }): Promise<OttlValidationResult>;
```

#### `ingestionSourceOttlStarter`

```typescript
ingestionSourceOttlStarter(input: { sourceType: string }): OttlStarterTemplate;
```

#### `governanceSetupState`

```typescript
governanceSetupState(input: { organizationId: string }): Promise<GovernanceSetupState>;
```

#### `governanceResolveHome`

```typescript
governanceResolveHome(input: { organizationId: string }, by: { id: string }): Promise<PersonaResolution>;
```

#### `governanceOcsfExport`

```typescript
governanceOcsfExport(input: GovernanceOcsfExportInput, by: EntitlementOperator): Promise<GovernanceOcsfExportPage>;
```

#### `governanceQuarantineFillStats`

```typescript
governanceQuarantineFillStats(input: QuarantineFillInput): Promise<QuarantineFillStats>;
```

#### `governanceRecordWorkspaceView`

```typescript
governanceRecordWorkspaceView(input: RecordWorkspaceViewInput): Promise<RecordWorkspaceViewResult>;
```

#### `findActorWorkspace`

```typescript
findActorWorkspace(input: { organizationId: string; actor: string; }): Promise<GovernanceActorWorkspace | null>;
```

#### `departmentList`

```typescript
departmentList(input: { organizationId: string }): Promise<Department[]>;
```

#### `departmentAssignments`

```typescript
departmentAssignments(input: { organizationId: string }): Promise<DepartmentAssignments>;
```

#### `departmentCreate`

```typescript
departmentCreate(input: { organizationId: string; name: string }): Promise<Department>;
```

#### `departmentRename`

```typescript
departmentRename(input: { id: string; organizationId: string; name: string; }): Promise<Department>;
```

#### `departmentArchive`

```typescript
departmentArchive(input: { id: string; organizationId: string }): Promise<void>;
```

#### `departmentResolveByNameOrCreate`

```typescript
departmentResolveByNameOrCreate(input: { organizationId: string; name: string; }): Promise<Department>;
```

#### `departmentAssignUser`

```typescript
departmentAssignUser(input: { organizationId: string; userId: string; departmentId: string | null; }): Promise<void>;
```

#### `departmentAssignTeam`

```typescript
departmentAssignTeam(input: { organizationId: string; teamId: string; departmentId: string | null; }): Promise<void>;
```

#### `departmentAssignProject`

```typescript
departmentAssignProject(input: { organizationId: string; projectId: string; departmentId: string | null; }): Promise<void>;
```

#### `personalUsage`

One person's own usage against a tenant the caller resolved.

```typescript
personalUsage(input: PersonalUsageQueryInput): Promise<PersonalUsageRollup>;
```

#### `getPersonalUsage`

`/api/me/usage`: the key's own usage; its credential's class is half the decision.

```typescript
getPersonalUsage(input: { projectId: string; credential: MePersonalCredential; window?: { startMs: number; endMs: number }; }): Promise<MeUsage>;
```

#### `personalUsageDashboard`

The caller's own /me rollup; `user_not_in_organization` (403) outside the organization.

```typescript
personalUsageDashboard(input: { organizationId: string; window?: PersonalUsageWindow }, by: GovernanceCaller): Promise<PersonalUsageRollup>;
```

#### `personalBudgetOverview`

```typescript
personalBudgetOverview(input: { organizationId: string; includeTopModels?: boolean }, by: GovernanceCaller): Promise<GovernanceBudgetOverviewForUser>;
```

#### `cliBootstrap`

```typescript
cliBootstrap(input: { organizationId: string }, by: GovernanceCaller): Promise<CliBootstrapResult>;
```

## REST transport

### `governanceCliRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/governance-cli.rest.ts:37` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | cli_token                                 |

#### `GET /api/auth/cli/budget/status` · `readCliBudgetStatus`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:42`.

Answers at `/api/auth/cli/budget/status`, `/api/v1/auth/cli/budget/status`.

#### `GET /api/auth/cli/bootstrap` · `readCliBootstrap`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:48`.

Answers at `/api/auth/cli/bootstrap`, `/api/v1/auth/cli/bootstrap`.

#### `GET /api/auth/cli/budget-overview` · `readCliBudgetOverview`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:54`.

Answers at `/api/auth/cli/budget-overview`, `/api/v1/auth/cli/budget-overview`.

#### `GET /api/auth/cli/personal-project` · `readCliPersonalProject`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:60`.

Answers at `/api/auth/cli/personal-project`, `/api/v1/auth/cli/personal-project`.

#### `POST /api/auth/cli/project-key` · `readCliProjectKey`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:68`.

Answers at `/api/auth/cli/project-key`, `/api/v1/auth/cli/project-key`.

```typescript
// Rawbody: "text" (inline, src/transport/governance-cli.rest.ts:69)
```

#### `POST /api/auth/cli/virtual-key` · `issueCliVirtualKey`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:80`.

Answers at `/api/auth/cli/virtual-key`, `/api/v1/auth/cli/virtual-key`.

```typescript
// Rawbody: "text" (inline, src/transport/governance-cli.rest.ts:81)
```

#### `GET /api/auth/cli/governance/ingest/sources` · `listCliIngestionSources`

Permission `ingestionSources:view`. Entitlement `enterprise` (feature `INGESTION_SOURCES`). Declared at `src/transport/governance-cli.rest.ts:87`.

Answers at `/api/auth/cli/governance/ingest/sources`, `/api/v1/auth/cli/governance/ingest/sources`.

```typescript
// Query: governanceCliSourcesQuerySchema, ../contract/src/governance-cli-rest.schemas.ts:47
interface Query {
  include_archived?: string;
}
```

#### `GET /api/auth/cli/governance/ingest/sources/:sourceId/events` · `listCliIngestionSourceEvents`

Permission `activityMonitor:view`. Entitlement `enterprise` (feature `ACTIVITY_MONITOR`). Declared at `src/transport/governance-cli.rest.ts:100`.

Answers at `/api/auth/cli/governance/ingest/sources/:sourceId/events`, `/api/v1/auth/cli/governance/ingest/sources/:sourceId/events`.

```typescript
// Params: governanceCliSourceParamsSchema, ../contract/src/governance-cli-rest.schemas.ts:42
interface Params {
  sourceId: string;
}
// Query: governanceCliSourceEventsQuerySchema, ../contract/src/governance-cli-rest.schemas.ts:59
interface Query {
  limit?: string;
  before_iso?: string;
}
```

#### `GET /api/auth/cli/governance/ingest/sources/:sourceId/health` · `readCliIngestionSourceHealth`

Permission `activityMonitor:view`. Entitlement `enterprise` (feature `INGESTION_SOURCES`). Declared at `src/transport/governance-cli.rest.ts:116`.

Answers at `/api/auth/cli/governance/ingest/sources/:sourceId/health`, `/api/v1/auth/cli/governance/ingest/sources/:sourceId/health`.

```typescript
type Params = z.infer<typeof governanceCliSourceParamsSchema>; // ../contract/src/governance-cli-rest.schemas.ts:42
```

#### `GET /api/auth/cli/governance/status` · `readCliGovernanceStatus`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Entitlement `enterprise` (feature `INGESTION_SOURCES`). Declared at `src/transport/governance-cli.rest.ts:129`.

Answers at `/api/auth/cli/governance/status`, `/api/v1/auth/cli/governance/status`.

#### `GET /api/auth/cli/governance/ingestion-templates` · `listCliIngestionTemplates`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:136`.

Answers at `/api/auth/cli/governance/ingestion-templates`, `/api/v1/auth/cli/governance/ingestion-templates`.

#### `POST /api/auth/cli/governance/ingestion-key` · `mintCliIngestionKey`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:142`.

Answers at `/api/auth/cli/governance/ingestion-key`, `/api/v1/auth/cli/governance/ingestion-key`.

```typescript
// Rawbody: "text" (inline, src/transport/governance-cli.rest.ts:143)
```

#### `GET /api/auth/cli/governance/ingestion-keys` · `listCliIngestionKeys`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:149`.

Answers at `/api/auth/cli/governance/ingestion-keys`, `/api/v1/auth/cli/governance/ingestion-keys`.

#### `GET /api/auth/cli/governance/ingestion-keys/:lookup_id` · `readCliIngestionKeyState`

Authenticated: main asked no permission here: the CLI token door admits the device-session bearer, and the key-minting routes check the active seat. Declared at `src/transport/governance-cli.rest.ts:155`.

Answers at `/api/auth/cli/governance/ingestion-keys/:lookup_id`, `/api/v1/auth/cli/governance/ingestion-keys/:lookup_id`.

```typescript
// Params: governanceCliKeyLookupParamsSchema, ../contract/src/governance-cli-rest.schemas.ts:44
interface Params {
  lookup_id: string;
}
```

### `governanceIngestRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/governance-ingest.rest.ts:20` |
| Base URL    | none: each route's path is its address       |
| Addressing  | literal                                      |
| Credential  | project                                      |

#### `POST /api/ingest/otel/:sourceId` · `ingestSourceOtlpTraces`

Public: an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body. Hidden from the OpenAPI document. Declared at `src/transport/governance-ingest.rest.ts:25`.

Answers at `/api/ingest/otel/:sourceId`, `/api/v1/ingest/otel/:sourceId`.

```typescript
// Params: governanceIngestSourceParamsSchema, ../contract/src/governance-ingest-rest.schemas.ts:9
interface Params {
  sourceId: string;
}
// Rawbody: "bytes" (inline, src/transport/governance-ingest.rest.ts:27)
type Headers = z.infer<typeof governanceIngestHeadersSchema>; // ../contract/src/governance-ingest-rest.schemas.ts:27
```

#### `POST /api/ingest/webhook/:sourceId` · `ingestSourceWebhook`

Public: an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body. Hidden from the OpenAPI document. Declared at `src/transport/governance-ingest.rest.ts:36`.

Answers at `/api/ingest/webhook/:sourceId`, `/api/v1/ingest/webhook/:sourceId`.

```typescript
type Params = z.infer<typeof governanceIngestSourceParamsSchema>; // ../contract/src/governance-ingest-rest.schemas.ts:9
// Rawbody: "text" (inline, src/transport/governance-ingest.rest.ts:38)
type Headers = z.infer<typeof governanceIngestHeadersSchema>; // ../contract/src/governance-ingest-rest.schemas.ts:27
```

#### `POST /api/ingest/otel/:sourceId/v1/logs` · `ingestSourceOtlpLogs`

Public: an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body. Hidden from the OpenAPI document. Declared at `src/transport/governance-ingest.rest.ts:47`.

Answers at `/api/ingest/otel/:sourceId/v1/logs`.

```typescript
type Params = z.infer<typeof governanceIngestSourceParamsSchema>; // ../contract/src/governance-ingest-rest.schemas.ts:9
// Rawbody: "bytes" (inline, src/transport/governance-ingest.rest.ts:49)
type Headers = z.infer<typeof governanceIngestHeadersSchema>; // ../contract/src/governance-ingest-rest.schemas.ts:27
```

#### `POST /api/ingest/otel/:sourceId/v1/metrics` · `ingestSourceOtlpMetrics`

Public: an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body. Hidden from the OpenAPI document. Declared at `src/transport/governance-ingest.rest.ts:58`.

Answers at `/api/ingest/otel/:sourceId/v1/metrics`.

```typescript
type Params = z.infer<typeof governanceIngestSourceParamsSchema>; // ../contract/src/governance-ingest-rest.schemas.ts:9
// Rawbody: "bytes" (inline, src/transport/governance-ingest.rest.ts:60)
type Headers = z.infer<typeof governanceIngestHeadersSchema>; // ../contract/src/governance-ingest-rest.schemas.ts:27
```

### `governanceRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/governance.rest.ts:109`       |
| Base URL    | `/api/governance`, twin `/api/v1/governance` |
| Addressing  | dated                                        |
| Credential  | project                                      |
| Versions    | `2026-08-07`                                 |

#### `GET /ingestion-templates` · `listIngestionTemplates`

List ingestion templates

Permission `aiTools:view`. Declared at `src/transport/governance.rest.ts:113`.

Answers at `/api/governance/ingestion-templates`, `/api/v1/governance/ingestion-templates`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates`, `/api/v1/governance/2026-08-07/ingestion-templates`, `/api/governance/latest/ingestion-templates`, `/api/v1/governance/latest/ingestion-templates`.

```typescript
type Response = z.infer<typeof governanceRestTemplateListSchema>; // ../contract/src/governance-rest.schemas.ts:51
```

#### `GET /ingestion-templates/admin` · `listIngestionTemplatesForAdmin`

List ingestion templates (admin shape, includes OTTL)

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:130`.

Answers at `/api/governance/ingestion-templates/admin`, `/api/v1/governance/ingestion-templates/admin`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/admin`, `/api/v1/governance/2026-08-07/ingestion-templates/admin`, `/api/governance/latest/ingestion-templates/admin`, `/api/v1/governance/latest/ingestion-templates/admin`.

```typescript
type Response = z.infer<typeof governanceRestTemplateListSchema>; // ../contract/src/governance-rest.schemas.ts:51
```

#### `GET /ingestion-templates/:ingestionTemplateId` · `getIngestionTemplate`

Get ingestion template

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:153`.

Answers at `/api/governance/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/ingestion-templates/:ingestionTemplateId`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/2026-08-07/ingestion-templates/:ingestionTemplateId`, `/api/governance/latest/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/latest/ingestion-templates/:ingestionTemplateId`.

```typescript
// Params: governanceRestTemplateParamsSchema, ../contract/src/governance-rest.schemas.ts:47
interface Params {
  ingestionTemplateId: string;
}
type Response = z.infer<typeof governanceRestTemplateDetailSchema>; // ../contract/src/governance-rest.schemas.ts:55
```

#### `POST /ingestion-templates` · `createIngestionTemplate`

Create org-authored ingestion template

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:176`.

Answers at `/api/governance/ingestion-templates`, `/api/v1/governance/ingestion-templates`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates`, `/api/v1/governance/2026-08-07/ingestion-templates`, `/api/governance/latest/ingestion-templates`, `/api/v1/governance/latest/ingestion-templates`.

```typescript
// Body: governanceRestCreateTemplateSchema, ../contract/src/governance-rest.schemas.ts:30
interface Body {
  source_type: string;
  display_name: string;
  description?: string;
  icon_asset?: string;
  credential_schema?: "otlp_token" | "static_api_key" | "agent_id" | null;
  ottl_rules?: string;
}
type Response = z.infer<typeof governanceRestTemplateDetailSchema>; // ../contract/src/governance-rest.schemas.ts:55
```

#### `PATCH /ingestion-templates/:ingestionTemplateId/ottl-rules` · `updateIngestionTemplateOttlRules`

Replace ottl_rules on an org-authored template

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:213`.

Answers at `/api/governance/ingestion-templates/:ingestionTemplateId/ottl-rules`, `/api/v1/governance/ingestion-templates/:ingestionTemplateId/ottl-rules`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/:ingestionTemplateId/ottl-rules`, `/api/v1/governance/2026-08-07/ingestion-templates/:ingestionTemplateId/ottl-rules`, `/api/governance/latest/ingestion-templates/:ingestionTemplateId/ottl-rules`, `/api/v1/governance/latest/ingestion-templates/:ingestionTemplateId/ottl-rules`.

```typescript
type Params = z.infer<typeof governanceRestTemplateParamsSchema>; // ../contract/src/governance-rest.schemas.ts:47
// Body: governanceRestUpdateOttlRulesSchema, ../contract/src/governance-rest.schemas.ts:39
interface Body {
  ottl_rules: string;
}
type Response = z.infer<typeof governanceRestTemplateDetailSchema>; // ../contract/src/governance-rest.schemas.ts:55
```

#### `DELETE /ingestion-templates/:ingestionTemplateId` · `archiveIngestionTemplate`

Soft-archive an org-authored template

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:236`.

Answers at `/api/governance/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/ingestion-templates/:ingestionTemplateId`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/2026-08-07/ingestion-templates/:ingestionTemplateId`, `/api/governance/latest/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/latest/ingestion-templates/:ingestionTemplateId`.

```typescript
type Params = z.infer<typeof governanceRestTemplateParamsSchema>; // ../contract/src/governance-rest.schemas.ts:47
// Response: governanceRestTemplateArchivedSchema, ../contract/src/governance-rest.schemas.ts:59
interface Response {
  archived: true;
}
```

#### `POST /ingestion-templates/clone` · `cloneIngestionTemplate`

Clone a platform-published template into the caller's org

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:258`.

Answers at `/api/governance/ingestion-templates/clone`, `/api/v1/governance/ingestion-templates/clone`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/clone`, `/api/v1/governance/2026-08-07/ingestion-templates/clone`, `/api/governance/latest/ingestion-templates/clone`, `/api/v1/governance/latest/ingestion-templates/clone`.

```typescript
// Body: governanceRestCloneTemplateSchema, ../contract/src/governance-rest.schemas.ts:43
interface Body {
  source_template_id: string;
}
type Response = z.infer<typeof governanceRestTemplateDetailSchema>; // ../contract/src/governance-rest.schemas.ts:55
```

### `meUsageRest`

|             |                                     |
| ----------- | ----------------------------------- |
| Declared at | `src/transport/me-usage.rest.ts:25` |
| Base URL    | `/api/me`, twin `/api/v1/me`        |
| Addressing  | dated                               |
| Credential  | project                             |
| Versions    | `2026-08-07`                        |

#### `GET /usage` · `getApiMeUsage`

Personal AI usage for the current month (or an explicit window): spend, billed spend, request + token counts, per-day buckets, and per-model breakdown. Requires a personal-project API key.

Permission `project:view`. Declared at `src/transport/me-usage.rest.ts:29`.

Answers at `/api/me/usage`, `/api/v1/me/usage`; also, undocumented, `/api/me/2026-08-07/usage`, `/api/v1/me/2026-08-07/usage`, `/api/me/latest/usage`, `/api/v1/me/latest/usage`.

```typescript
// Query: meUsageQuerySchema, ../contract/src/personal-usage.ts:83
interface Query {
  windowStartMs?: number;
  windowEndMs?: number;
}
type Response = z.infer<typeof meUsageResponseSchema>; // ../contract/src/personal-usage.ts:129
```

## tRPC transport

### `activityMonitor`

Contract `../contract/src/activity-monitor.trpc.ts:35`, router `src/transport/activity-monitor.trpc.ts:12`.

| Procedure                                | Kind  | Gate                              | Input                  | Output                         |
| ---------------------------------------- | ----- | --------------------------------- | ---------------------- | ------------------------------ |
| `activityMonitor.summary`                | query | Permission `activityMonitor:view` | `windowQuery`          | `activityMonitorSummarySchema` |
| `activityMonitor.spendByUser`            | query | Permission `activityMonitor:view` | `pagedWindowQuery`     | inline                         |
| `activityMonitor.spendByTeam`            | query | Permission `activityMonitor:view` | `pagedWindowQuery`     | inline                         |
| `activityMonitor.spendByDepartment`      | query | Permission `activityMonitor:view` | `windowQuery`          | inline                         |
| `activityMonitor.spendOverTime`          | query | Permission `activityMonitor:view` | inline                 | `spendOverTimeResultSchema`    |
| `activityMonitor.ingestionSourcesHealth` | query | Permission `activityMonitor:view` | `organizationScope`    | inline                         |
| `activityMonitor.recentAnomalies`        | query | Permission `activityMonitor:view` | inline                 | inline                         |
| `activityMonitor.eventsForSource`        | query | Permission `activityMonitor:view` | inline                 | inline                         |
| `activityMonitor.sourceHealthMetrics`    | query | Permission `activityMonitor:view` | `sourceInOrganization` | `sourceHealthMetricsSchema`    |

```typescript
// activityMonitor.summary
// Input: windowQuery, ../contract/src/activity-monitor.trpc.ts:22
interface Input {
  organizationId: string;
  windowDays?: number;
}
type Output = z.infer<typeof activityMonitorSummarySchema>; // ../contract/src/ingestion-source-activity.queries.ts:28

// activityMonitor.spendByUser
// Input: pagedWindowQuery, ../contract/src/activity-monitor.trpc.ts:26
interface Input {
  organizationId: string;
  windowDays?: number;
  limit?: number;
  offset?: number;
  sortBy?: "spend" | "requests" | "lastActivity";
  sortDir?: "asc" | "desc";
}
// Output: inline, ../contract/src/activity-monitor.trpc.ts:42
type Output = {
  actor: string;
  spendUsd: string;
  requests: number;
  lastActivityIso: string;
  trendVsPreviousPct: number;
  hasPriorBaseline: boolean;
  mostUsedTarget: string | null;
}[];

// activityMonitor.spendByTeam
type Input = z.infer<typeof pagedWindowQuery>; // ../contract/src/activity-monitor.trpc.ts:26
// Output: inline, ../contract/src/activity-monitor.trpc.ts:46
type Output = {
  teamId: string | null;
  teamName: string;
  spendUsd: string;
  requestCount: number;
  deltaPctVsPriorWindow: number;
  hasPriorBaseline: boolean;
  lastActivityIso: string | null;
  sourceCount: number;
}[];

// activityMonitor.spendByDepartment
type Input = z.infer<typeof windowQuery>; // ../contract/src/activity-monitor.trpc.ts:22
// Output: inline, ../contract/src/activity-monitor.trpc.ts:50
type Output = {
  departmentId: string | null;
  departmentName: string;
  spendUsd: string;
  requestCount: number;
  lastActivityIso: string | null;
}[];

// activityMonitor.spendOverTime
// Input: inline, ../contract/src/activity-monitor.trpc.ts:54
interface Input {
  organizationId: string;
  windowDays?: number;
  groupBy?: "team" | "user" | "model";
}
// Output: spendOverTimeResultSchema, ../contract/src/ingestion-source-activity.queries.ts:106
interface Output {
  buckets: {
    bucketIso: string;
    points: {
      key: string;
      label: string;
      spendUsd: string;
    }[];
  }[];
}

// activityMonitor.ingestionSourcesHealth
// Input: organizationScope, ../contract/src/activity-monitor.trpc.ts:21
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/activity-monitor.trpc.ts:60
type Output = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  lastEventIso: string | null;
  eventsLast24h: number;
}[];

// activityMonitor.recentAnomalies
// Input: inline, ../contract/src/activity-monitor.trpc.ts:64
interface Input {
  organizationId: string;
  limit?: number;
}
// Output: recentAnomalyRowSchema.array() (inline, ../contract/src/activity-monitor.trpc.ts:66)

// activityMonitor.eventsForSource
// Input: inline, ../contract/src/activity-monitor.trpc.ts:70
interface Input {
  organizationId: string;
  sourceId: string;
  limit?: number;
  beforeIso?: string;
}
// Output: activityEventDetailRowSchema.array() (inline, ../contract/src/activity-monitor.trpc.ts:76)

// activityMonitor.sourceHealthMetrics
// Input: sourceInOrganization, ../contract/src/activity-monitor.trpc.ts:33
interface Input {
  organizationId: string;
  sourceId: string;
}
// Output: sourceHealthMetricsSchema, ../contract/src/ingestion-source-activity.queries.ts:149
interface Output {
  events24h: number;
  events7d: number;
  events30d: number;
  lastSuccessIso: string | null;
}
```

### `aiTools`

Contract `../contract/src/ai-tools.trpc.ts:56`, router `src/transport/ai-tools.trpc.ts:10`.

| Procedure                        | Kind     | Gate                        | Input                 | Output                              |
| -------------------------------- | -------- | --------------------------- | --------------------- | ----------------------------------- |
| `aiTools.list`                   | query    | Permission `aiTools:view`   | `organizationScope`   | inline                              |
| `aiTools.providerAvailability`   | query    | Permission `aiTools:view`   | `organizationScope`   | `aiToolProviderAvailabilitySchema`  |
| `aiTools.claudeCodeOtlpEndpoint` | query    | Permission `aiTools:view`   | `organizationScope`   | `aiToolOtlpEndpointSchema`          |
| `aiTools.adminList`              | query    | Permission `aiTools:manage` | `organizationScope`   | inline                              |
| `aiTools.get`                    | query    | Permission `aiTools:manage` | `entryInOrganization` | `aiToolEntrySchema`                 |
| `aiTools.create`                 | mutation | Permission `aiTools:manage` | `aiToolCreateSchema`  | `aiToolEntrySchema`                 |
| `aiTools.update`                 | mutation | Permission `aiTools:manage` | `aiToolUpdateSchema`  | `aiToolEntrySchema`                 |
| `aiTools.remove`                 | mutation | Permission `aiTools:manage` | `entryInOrganization` | `aiToolEntrySchema`                 |
| `aiTools.setEnabled`             | mutation | Permission `aiTools:manage` | inline                | `aiToolEntrySchema`                 |
| `aiTools.importStarterPack`      | mutation | Permission `aiTools:manage` | inline                | `aiToolStarterPackImportSchema`     |
| `aiTools.starterPackCatalog`     | query    | Permission `aiTools:manage` | `organizationScope`   | inline                              |
| `aiTools.providerOptions`        | query    | Permission `aiTools:manage` | `organizationScope`   | inline                              |
| `aiTools.routingPolicyOptions`   | query    | Permission `aiTools:manage` | `organizationScope`   | inline                              |
| `aiTools.reorder`                | mutation | Permission `aiTools:manage` | inline                | `governanceWriteAcknowledgedSchema` |

```typescript
// aiTools.list
// Input: organizationScope, ../contract/src/ai-tools.trpc.ts:18
interface Input {
  organizationId: string;
}
// Output: aiToolEntrySchema.array() (inline, ../contract/src/ai-tools.trpc.ts:59)

// aiTools.providerAvailability
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: aiToolProviderAvailabilitySchema, ../contract/src/ai-tool-catalog.ts:286
interface Output {
  configuredProviders: string[];
}

// aiTools.claudeCodeOtlpEndpoint
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: aiToolOtlpEndpointSchema, ../contract/src/ai-tool-catalog.ts:295
interface Output {
  endpoint: string | null;
}

// aiTools.adminList
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: aiToolEntrySchema.array() (inline, ../contract/src/ai-tools.trpc.ts:71)

// aiTools.get
// Input: entryInOrganization, ../contract/src/ai-tools.trpc.ts:19
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:77

// aiTools.create
// Input: aiToolCreateSchema, ../contract/src/ai-tools.trpc.ts:35
interface Input {
  organizationId: string;
  departmentIds?: string[];
  type: "coding_assistant" | "model_provider" | "external_tool";
  displayName: string;
  iconAsset?: string | null;
  order?: number;
  config: Record<string, unknown>;
}
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:77

// aiTools.update
// Input: aiToolUpdateSchema, ../contract/src/ai-tools.trpc.ts:45
interface Input {
  organizationId: string;
  id: string;
  displayName?: string;
  iconAsset?: string | null;
  departmentIds?: string[];
  order?: number;
  enabled?: boolean;
  type?: "coding_assistant" | "model_provider" | "external_tool";
  config?: Record<string, unknown>;
}
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:77

// aiTools.remove
type Input = z.infer<typeof entryInOrganization>; // ../contract/src/ai-tools.trpc.ts:19
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:77

// aiTools.setEnabled
// Input: inline, ../contract/src/ai-tools.trpc.ts:90
interface Input {
  organizationId: string;
  id: string;
  enabled: boolean;
}
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:77

// aiTools.importStarterPack
// Input: inline, ../contract/src/ai-tools.trpc.ts:94
interface Input {
  organizationId: string;
  slugs?: string[];
}
// Output: aiToolStarterPackImportSchema, ../contract/src/ai-tool-catalog.ts:308
interface Output {
  created: number;
  updated: number;
  skipped: number;
}

// aiTools.starterPackCatalog
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: inline, ../contract/src/ai-tools.trpc.ts:99
type Output = {
  slug: string;
  displayName: string;
  type: "coding_assistant" | "model_provider" | "external_tool";
}[];

// aiTools.providerOptions
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: inline, ../contract/src/ai-tools.trpc.ts:103
type Output = {
  providerKey: string;
  displayName: string;
  configured: boolean;
}[];

// aiTools.routingPolicyOptions
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: inline, ../contract/src/ai-tools.trpc.ts:107
type Output = {
  id: string;
  name: string;
}[];

// aiTools.reorder
// Input: inline, ../contract/src/ai-tools.trpc.ts:111
interface Input {
  organizationId: string;
  updates: {
    id: string;
    order: number;
  }[];
}
// Output: governanceWriteAcknowledgedSchema, ../contract/src/governance.responses.ts:8
interface Output {
  ok: boolean;
}
```

### `anomalyRules`

Contract `../contract/src/anomaly-rules.trpc.ts:15`, router `src/transport/anomaly-rules.trpc.ts:12`.

| Procedure              | Kind     | Gate                             | Input                          | Output              |
| ---------------------- | -------- | -------------------------------- | ------------------------------ | ------------------- |
| `anomalyRules.list`    | query    | Permission `anomalyRules:view`   | `organizationScope`            | inline              |
| `anomalyRules.get`     | query    | Permission `anomalyRules:view`   | `ruleInOrganization`           | `anomalyRuleSchema` |
| `anomalyRules.create`  | mutation | Permission `anomalyRules:manage` | inline                         | `anomalyRuleSchema` |
| `anomalyRules.update`  | mutation | Permission `anomalyRules:manage` | `updateAnomalyRuleInputSchema` | `anomalyRuleSchema` |
| `anomalyRules.archive` | mutation | Permission `anomalyRules:manage` | `ruleInOrganization`           | `anomalyRuleSchema` |

```typescript
// anomalyRules.list
// Input: organizationScope, ../contract/src/anomaly-rules.trpc.ts:12
interface Input {
  organizationId: string;
}
// Output: anomalyRuleSchema.array() (inline, ../contract/src/anomaly-rules.trpc.ts:18)

// anomalyRules.get
// Input: ruleInOrganization, ../contract/src/anomaly-rules.trpc.ts:13
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof anomalyRuleSchema>; // ../contract/src/anomaly-rule.ts:24

// anomalyRules.create
// Input: inline, ../contract/src/anomaly-rules.trpc.ts:25
interface Input {
  organizationId: string;
  name: string;
  description?: string | null;
  severity: "critical" | "warning" | "info";
  ruleType: string;
  scope: "organization" | "team" | "project" | "source_type" | "source";
  scopeId: string;
  thresholdConfig?: Record<string, unknown>;
  destinationConfig?: Record<string, unknown>;
  status?: "active" | "disabled";
}
type Output = z.infer<typeof anomalyRuleSchema>; // ../contract/src/anomaly-rule.ts:24

// anomalyRules.update
type Input = z.infer<typeof updateAnomalyRuleInputSchema>; // ../contract/src/anomaly-rule.ts:58
type Output = z.infer<typeof anomalyRuleSchema>; // ../contract/src/anomaly-rule.ts:24

// anomalyRules.archive
type Input = z.infer<typeof ruleInOrganization>; // ../contract/src/anomaly-rules.trpc.ts:13
type Output = z.infer<typeof anomalyRuleSchema>; // ../contract/src/anomaly-rule.ts:24
```

### `departments`

Contract `../contract/src/departments.trpc.ts:13`, router `src/transport/departments.trpc.ts:13`.

| Procedure                   | Kind     | Gate                           | Input                      | Output                              |
| --------------------------- | -------- | ------------------------------ | -------------------------- | ----------------------------------- |
| `departments.list`          | query    | Permission `governance:view`   | `organizationScope`        | inline                              |
| `departments.assignments`   | query    | Permission `governance:view`   | `organizationScope`        | `departmentAssignmentsSchema`       |
| `departments.create`        | mutation | Permission `governance:manage` | inline                     | `departmentSchema`                  |
| `departments.rename`        | mutation | Permission `governance:manage` | inline                     | `departmentSchema`                  |
| `departments.archive`       | mutation | Permission `governance:manage` | `departmentInOrganization` | `governanceWriteAcknowledgedSchema` |
| `departments.assignUser`    | mutation | Permission `governance:manage` | inline                     | `governanceWriteAcknowledgedSchema` |
| `departments.assignTeam`    | mutation | Permission `governance:manage` | inline                     | `governanceWriteAcknowledgedSchema` |
| `departments.assignProject` | mutation | Permission `governance:manage` | inline                     | `governanceWriteAcknowledgedSchema` |

```typescript
// departments.list
// Input: organizationScope, ../contract/src/departments.trpc.ts:9
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/departments.trpc.ts:16
type Output = {
  id: string;
  name: string;
  organizationId: string;
  createdAt: unknown;
  updatedAt: unknown;
}[];

// departments.assignments
type Input = z.infer<typeof organizationScope>; // ../contract/src/departments.trpc.ts:9
type Output = z.infer<typeof departmentAssignmentsSchema>; // ../contract/src/department.ts:27

// departments.create
// Input: inline, ../contract/src/departments.trpc.ts:23
interface Input {
  organizationId: string;
  name: string;
}
// Output: departmentSchema, ../contract/src/department.ts:5
interface Output {
  id: string;
  name: string;
  organizationId: string;
  createdAt: unknown;
  updatedAt: unknown;
}

// departments.rename
// Input: inline, ../contract/src/departments.trpc.ts:27
interface Input {
  organizationId: string;
  id: string;
  name: string;
}
type Output = z.infer<typeof departmentSchema>; // ../contract/src/department.ts:5

// departments.archive
// Input: departmentInOrganization, ../contract/src/departments.trpc.ts:11
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:8

// departments.assignUser
// Input: inline, ../contract/src/departments.trpc.ts:36
interface Input {
  organizationId: string;
  userId: string;
  departmentId: string | null;
}
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:8

// departments.assignTeam
// Input: inline, ../contract/src/departments.trpc.ts:46
interface Input {
  organizationId: string;
  teamId: string;
  departmentId: string | null;
}
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:8

// departments.assignProject
// Input: inline, ../contract/src/departments.trpc.ts:56
interface Input {
  organizationId: string;
  projectId: string;
  departmentId: string | null;
}
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:8
```

### `governanceAgents`

Contract `../contract/src/governance-agents.ts:60`, router `src/transport/governance-agents.trpc.ts:9`.

| Procedure                         | Kind     | Gate                           | Input               | Output                            |
| --------------------------------- | -------- | ------------------------------ | ------------------- | --------------------------------- |
| `governanceAgents.list`           | query    | Permission `governance:view`   | `organizationScope` | inline                            |
| `governanceAgents.syncSources`    | query    | Permission `governance:view`   | `organizationScope` | inline                            |
| `governanceAgents.requestListing` | mutation | Permission `governance:manage` | `organizationScope` | `agentListingRequestResultSchema` |

```typescript
// governanceAgents.list
// Input: organizationScope, ../contract/src/governance-agents.ts:15
interface Input {
  organizationId: string;
}
// Output: governanceAgentRowSchema.array() (inline, ../contract/src/governance-agents.ts:63)

// governanceAgents.syncSources
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance-agents.ts:15
// Output: agentSyncSourceListingSchema.array() (inline, ../contract/src/governance-agents.ts:67)

// governanceAgents.requestListing
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance-agents.ts:15
// Output: agentListingRequestResultSchema, ../contract/src/governance-agents.ts:30
interface Output {
  requested: number;
  sources: {
    id: string;
    name: string;
    sourceType: string;
  }[];
}
```

### `governanceCost`

Contract `../contract/src/governance-cost.trpc.ts:15`, router `src/transport/governance-cost.trpc.ts:13`.

| Procedure                        | Kind  | Gate                                                | Input                                    | Output                                     |
| -------------------------------- | ----- | --------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `governanceCost.summary`         | query | Permission `governanceCost:view`                    | `governanceCostWindowInputSchema`        | `governanceCostSummarySchema`              |
| `governanceCost.dailyByProvider` | query | Permission `governanceCost:view`                    | `governanceCostWindowInputSchema`        | `governanceCostProviderDayBreakdownSchema` |
| `governanceCost.spendByModel`    | query | Permission `governanceCost:view`                    | `governanceCostWindowInputSchema`        | `governanceCostModelBreakdownSchema`       |
| `governanceCost.periodRecords`   | query | Permission `governanceCost:view`                    | `governanceCostPeriodRecordsInputSchema` | `governanceCostDayRecordsSchema`           |
| `governanceCost.spenders`        | query | Permission `governanceCost:view or governance:view` | `governanceCostWindowInputSchema`        | `governanceSpenderBreakdownSchema`         |

```typescript
// governanceCost.summary
// Input: governanceCostWindowInputSchema, ../contract/src/governance-cost.ts:27
interface Input {
  organizationId: string;
  windowDays?: number;
}
type Output = z.infer<typeof governanceCostSummarySchema>; // ../contract/src/governance-cost.ts:179

// governanceCost.dailyByProvider
type Input = z.infer<typeof governanceCostWindowInputSchema>; // ../contract/src/governance-cost.ts:27
// Output: governanceCostProviderDayBreakdownSchema, ../contract/src/governance-cost.ts:59
interface Output {
  unavailableReason: "no_cost_store" | "no_governance_project" | null;
  rows: {
    day: string;
    provider: string;
    amountUsd: number | null;
    cellsWithoutAmount: number;
    currenciesWithoutUsdAmount: string[];
  }[];
  windowDays: number;
}

// governanceCost.spendByModel
type Input = z.infer<typeof governanceCostWindowInputSchema>; // ../contract/src/governance-cost.ts:27
// Output: governanceCostModelBreakdownSchema, ../contract/src/governance-cost.ts:71
interface Output {
  unavailableReason: "no_cost_store" | "no_governance_project" | null;
  rows: {
    model: string;
    amountUsd: number | null;
    cellsWithoutAmount: number;
    currenciesWithoutUsdAmount: string[];
  }[];
  windowDays: number;
}

// governanceCost.periodRecords
// Input: governanceCostPeriodRecordsInputSchema, ../contract/src/governance-cost.ts:33
interface Input {
  organizationId: string;
  fromDay: string;
  toDay: string;
  provider: string;
}
// Output: governanceCostDayRecordsSchema, ../contract/src/governance-cost.ts:84
interface Output {
  unavailableReason: "no_cost_store" | "no_governance_project" | null;
  records: {
    label: string;
    amountUsd: number | null;
    cellsWithoutAmount: number;
    currenciesWithoutUsdAmount: string[];
  }[];
}

// governanceCost.spenders
type Input = z.infer<typeof governanceCostWindowInputSchema>; // ../contract/src/governance-cost.ts:27
type Output = z.infer<typeof governanceSpenderBreakdownSchema>; // ../contract/src/governance-cost.ts:99
```

### `governancePeople`

Contract `../contract/src/governance-people.ts:55`, router `src/transport/governance-people.trpc.ts:9`.

| Procedure                            | Kind     | Gate                           | Input               | Output                         |
| ------------------------------------ | -------- | ------------------------------ | ------------------- | ------------------------------ |
| `governancePeople.list`              | query    | Permission `governance:view`   | `organizationScope` | inline                         |
| `governancePeople.suggestions`       | query    | Permission `governance:view`   | `organizationScope` | inline                         |
| `governancePeople.runMatch`          | mutation | Permission `governance:manage` | `organizationScope` | `identityMatchRunSchema`       |
| `governancePeople.confirmSuggestion` | mutation | Permission `governance:manage` | inline              | `identityMatchConfirmedSchema` |

```typescript
// governancePeople.list
// Input: organizationScope, ../contract/src/governance-people.ts:6
interface Input {
  organizationId: string;
}
// Output: peopleScreenPersonSchema.array() (inline, ../contract/src/governance-people.ts:58)

// governancePeople.suggestions
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance-people.ts:6
// Output: inline, ../contract/src/governance-people.ts:62
type Output = {
  id: string;
  discoveredPersonId: string;
  personDisplayText: string;
  personProvider: string;
  userId: string;
  memberName: string | null;
  score: number;
}[];

// governancePeople.runMatch
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance-people.ts:6
// Output: identityMatchRunSchema, ../contract/src/governance-people.ts:42
interface Output {
  linked: number;
  suspended: number;
  unproven: number;
}

// governancePeople.confirmSuggestion
// Input: inline, ../contract/src/governance-people.ts:69
interface Input {
  organizationId: string;
  suggestionId: string;
}
// Output: identityMatchConfirmedSchema, ../contract/src/governance-people.ts:49
interface Output {
  discoveredPersonId: string;
  userId: string;
}
```

### `governance`

Contract `../contract/src/governance.trpc.ts:25`, router `src/transport/governance.trpc.ts:13`.

| Procedure                                | Kind     | Gate                               | Input               | Output                                  |
| ---------------------------------------- | -------- | ---------------------------------- | ------------------- | --------------------------------------- |
| `governance.resolveActorPersonalProject` | query    | Permission `governance:view`       | inline              | inline                                  |
| `governance.resolveHome`                 | query    | Permission `organization:view`     | `organizationScope` | `personaResolutionSchema`               |
| `governance.setupState`                  | query    | Permission `governance:view`       | `organizationScope` | `governanceSetupStateSchema`            |
| `governance.ocsfExport`                  | query    | Permission `complianceExport:view` | inline              | `governanceOcsfExportPageSchema`        |
| `governance.quarantineFillStats`         | query    | Permission `governance:view`       | inline              | `quarantineFillStatsSchema`             |
| `governance.recordWorkspaceView`         | mutation | Permission `governance:view`       | inline              | `recordWorkspaceViewResultSchema`       |
| `governance.personalUsage`               | query    | Permission `organization:view`     | inline              | `personalUsageRollupSchema`             |
| `governance.budgetOverview`              | query    | Permission `organization:view`     | inline              | `governanceBudgetOverviewForUserSchema` |
| `governance.cliBootstrap`                | query    | Permission `organization:view`     | `organizationScope` | `cliBootstrapResultSchema`              |

```typescript
// governance.resolveActorPersonalProject
// Input: inline, ../contract/src/governance.trpc.ts:28
interface Input {
  organizationId: string;
  actor: string;
}
// Output: inline, ../contract/src/governance.trpc.ts:29
type Output = {
  userId: string;
  displayName: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
} | null;

// governance.resolveHome
// Input: organizationScope, ../contract/src/governance.trpc.ts:23
interface Input {
  organizationId: string;
}
// Output: personaResolutionSchema, ../contract/src/persona-home.ts:31
interface Output {
  persona: "personal_only" | "mixed" | "project_only" | "governance_admin";
  destination: string;
  isOverride: boolean;
  governanceUiEnabled: boolean;
  intentPinned: boolean;
  firstProjectSlug: string | null;
}

// governance.setupState
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance.trpc.ts:23
// Output: governanceSetupStateSchema, ../contract/src/governance.ts:42
interface Output {
  hasPersonalVKs: boolean;
  hasRoutingPolicies: boolean;
  hasIngestionSources: boolean;
  hasAnomalyRules: boolean;
  hasRecentActivity: boolean;
  hasApplicationTraces: boolean;
  governanceActive: boolean;
}

// governance.ocsfExport
// Input: inline, ../contract/src/governance.trpc.ts:44
interface Input {
  organizationId: string;
  sinceMs?: number;
  sinceEventId?: string;
  limit?: number;
}
type Output = z.infer<typeof governanceOcsfExportPageSchema>; // ../contract/src/ocsf-export.ts:25

// governance.quarantineFillStats
// Input: inline, ../contract/src/governance.trpc.ts:56
interface Input {
  organizationId: string;
  windowSeconds?: number;
  threshold?: number;
}
// Output: quarantineFillStatsSchema, ../contract/src/quarantine-fill.ts:15
interface Output {
  windowSeconds: number;
  threshold: number;
  spanCount: number;
  rate: number;
  exceeded: boolean;
  perSource: {
    ingestionSourceId: string;
    spanCount: number;
  }[];
}

// governance.recordWorkspaceView
// Input: inline, ../contract/src/governance.trpc.ts:67
interface Input {
  organizationId: string;
  targetTeamId: string;
  kind: "personal" | "team";
  workspaceLabel?: string;
}
// Output: recordWorkspaceViewResultSchema, ../contract/src/admin-workspace-view-audit.ts:20
interface Output {
  recorded: boolean;
  auditLogId: string | null;
}

// governance.personalUsage
// Input: inline, ../contract/src/governance.trpc.ts:79
interface Input {
  organizationId: string;
  windowStartMs?: number;
  windowEndMs?: number;
}
type Output = z.infer<typeof personalUsageRollupSchema>; // ../contract/src/personal-usage.ts:64

// governance.budgetOverview
// Input: inline, ../contract/src/governance.trpc.ts:89
interface Input {
  organizationId: string;
  includeTopModels?: boolean;
}
type Output = z.infer<typeof governanceBudgetOverviewForUserSchema>; // ../contract/src/personal-budget-overview.ts:50

// governance.cliBootstrap
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance.trpc.ts:23
type Output = z.infer<typeof cliBootstrapResultSchema>; // ../contract/src/cli-bootstrap.ts:25
```

### `ingestionKey`

Contract `../contract/src/ingestion-key.trpc.ts:37`, router `src/transport/ingestion-key.trpc.ts:12`.

| Procedure              | Kind     | Gate                           | Input                         | Output                      |
| ---------------------- | -------- | ------------------------------ | ----------------------------- | --------------------------- |
| `ingestionKey.list`    | query    | Permission `organization:view` | inline                        | inline                      |
| `ingestionKey.install` | mutation | Permission `organization:view` | `ingestionKeyMintInputSchema` | `issuedIngestionKeySchema`  |
| `ingestionKey.rotate`  | mutation | Permission `organization:view` | `ingestionKeyMintInputSchema` | `rotatedIngestionKeySchema` |
| `ingestionKey.revoke`  | mutation | Permission `organization:view` | inline                        | inline                      |

```typescript
// ingestionKey.list
// Input: inline, ../contract/src/ingestion-key.trpc.ts:39
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/ingestion-key.trpc.ts:40
type Output = {
  apiKeyId: string;
  name: string;
  sourceType: string;
  lookupId: string;
  ingestionTemplateId: string | null;
  deviceLabel: string | null;
  parentApiKeyId: string | null;
  createdAtMs: number;
  lastUsedAtMs: number | null;
}[];

// ingestionKey.install
// Input: ingestionKeyMintInputSchema, ../contract/src/ingestion-key.trpc.ts:25
interface Input {
  organizationId: string;
  sourceType: string;
  templateId?: string;
}
// Output: issuedIngestionKeySchema, ../contract/src/ingestion-source-key.commands.ts:17
interface Output {
  token: string;
  apiKeyId: string;
  prefix: string;
  sourceType: string;
}

// ingestionKey.rotate
type Input = z.infer<typeof ingestionKeyMintInputSchema>; // ../contract/src/ingestion-key.trpc.ts:25
// Output: rotatedIngestionKeySchema, ../contract/src/ingestion-key.trpc.ts:31
interface Output {
  token: string;
  apiKeyId: string;
  prefix: string;
  sourceType: string;
  revokedCount: number;
  revokedDeviceLabels: string[];
}

// ingestionKey.revoke
// Input: inline, ../contract/src/ingestion-key.trpc.ts:51
interface Input {
  organizationId: string;
  apiKeyId: string;
}
// Output: inline, ../contract/src/ingestion-key.trpc.ts:52
interface Output {
  success: true;
}
```

### `ingestionSources`

Contract `../contract/src/ingestion-sources.trpc.ts:47`, router `src/transport/ingestion-sources.trpc.ts:12`.

| Procedure                       | Kind     | Gate                                 | Input                              | Output                            |
| ------------------------------- | -------- | ------------------------------------ | ---------------------------------- | --------------------------------- |
| `ingestionSources.list`         | query    | Permission `ingestionSources:view`   | `organizationScope`                | inline                            |
| `ingestionSources.get`          | query    | Permission `ingestionSources:view`   | `sourceInOrganization`             | `ingestionSourceDtoSchema`        |
| `ingestionSources.create`       | mutation | Permission `ingestionSources:manage` | `ingestionSourceCreateInputSchema` | `createdIngestionSourceSchema`    |
| `ingestionSources.update`       | mutation | Permission `ingestionSources:manage` | `ingestionSourceUpdateInputSchema` | `ingestionSourceDtoSchema`        |
| `ingestionSources.rotateSecret` | mutation | Permission `ingestionSources:manage` | `sourceInOrganization`             | `ingestionSourceWithSecretSchema` |
| `ingestionSources.archive`      | mutation | Permission `ingestionSources:manage` | `sourceInOrganization`             | `ingestionSourceDtoSchema`        |
| `ingestionSources.validateOttl` | mutation | Permission `ingestionSources:manage` | inline                             | `ottlValidationResultSchema`      |
| `ingestionSources.ottlStarter`  | query    | Permission `ingestionSources:view`   | inline                             | `ottlStarterTemplateSchema`       |

```typescript
// ingestionSources.list
// Input: organizationScope, ../contract/src/ingestion-sources.trpc.ts:14
interface Input {
  organizationId: string;
}
// Output: ingestionSourceDtoSchema.array() (inline, ../contract/src/ingestion-sources.trpc.ts:50)

// ingestionSources.get
// Input: sourceInOrganization, ../contract/src/ingestion-sources.trpc.ts:15
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof ingestionSourceDtoSchema>; // ../contract/src/ingestion-source.ts:39

// ingestionSources.create
type Input = z.infer<typeof ingestionSourceCreateInputSchema>; // ../contract/src/ingestion-sources.trpc.ts:17
type Output = z.infer<typeof createdIngestionSourceSchema>; // ../contract/src/ingestion-sources.trpc.ts:43

// ingestionSources.update
// Input: ingestionSourceUpdateInputSchema, ../contract/src/ingestion-sources.trpc.ts:30
interface Input {
  organizationId: string;
  id: string;
  name?: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  status?: "active" | "disabled" | "awaiting_first_event";
  teamId?: string | null;
  pullSchedule?: string | null;
  traceProjectId?: string | null;
}
type Output = z.infer<typeof ingestionSourceDtoSchema>; // ../contract/src/ingestion-source.ts:39

// ingestionSources.rotateSecret
type Input = z.infer<typeof sourceInOrganization>; // ../contract/src/ingestion-sources.trpc.ts:15
type Output = z.infer<typeof ingestionSourceWithSecretSchema>; // ../contract/src/ingestion-source.ts:72

// ingestionSources.archive
type Input = z.infer<typeof sourceInOrganization>; // ../contract/src/ingestion-sources.trpc.ts:15
type Output = z.infer<typeof ingestionSourceDtoSchema>; // ../contract/src/ingestion-source.ts:39

// ingestionSources.validateOttl
// Input: inline, ../contract/src/ingestion-sources.trpc.ts:74
interface Input {
  organizationId: string;
  statements: string[];
}
type Output = z.infer<typeof ottlValidationResultSchema>; // ../contract/src/ottl.ts:19

// ingestionSources.ottlStarter
// Input: inline, ../contract/src/ingestion-sources.trpc.ts:79
interface Input {
  organizationId: string;
  sourceType: string;
}
// Output: ottlStarterTemplateSchema, ../contract/src/ingestion-source.ts:80
interface Output {
  enabled: boolean;
  statements: string[];
  enabledSourceTypes: string[];
}
```

### `ingestionTemplates`

Contract `../contract/src/ingestion-templates.trpc.ts:22`, router `src/transport/ingestion-templates.trpc.ts:15`.

| Procedure                              | Kind     | Gate                        | Input                           | Output                              |
| -------------------------------------- | -------- | --------------------------- | ------------------------------- | ----------------------------------- |
| `ingestionTemplates.list`              | query    | Permission `aiTools:view`   | `organizationScope`             | inline                              |
| `ingestionTemplates.adminList`         | query    | Permission `aiTools:manage` | `organizationScope`             | inline                              |
| `ingestionTemplates.get`               | query    | Permission `aiTools:view`   | `templateInOrganization`        | `ingestionTemplateSchema`           |
| `ingestionTemplates.create`            | mutation | Permission `aiTools:manage` | `ingestionTemplateCreateSchema` | `ingestionTemplateSchema`           |
| `ingestionTemplates.updateOttlRules`   | mutation | Permission `aiTools:manage` | inline                          | `ingestionTemplateSchema`           |
| `ingestionTemplates.archive`           | mutation | Permission `aiTools:manage` | `templateInOrganization`        | `governanceWriteAcknowledgedSchema` |
| `ingestionTemplates.cloneFromPlatform` | mutation | Permission `aiTools:manage` | inline                          | `ingestionTemplateSchema`           |

```typescript
// ingestionTemplates.list
// Input: organizationScope, ../contract/src/ingestion-templates.trpc.ts:9
interface Input {
  organizationId: string;
}
// Output: ingestionTemplateSchema.array() (inline, ../contract/src/ingestion-templates.trpc.ts:25)

// ingestionTemplates.adminList
type Input = z.infer<typeof organizationScope>; // ../contract/src/ingestion-templates.trpc.ts:9
// Output: ingestionTemplateSchema.array() (inline, ../contract/src/ingestion-templates.trpc.ts:29)

// ingestionTemplates.get
// Input: templateInOrganization, ../contract/src/ingestion-templates.trpc.ts:10
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof ingestionTemplateSchema>; // ../contract/src/ingestion-template.ts:9

// ingestionTemplates.create
// Input: ingestionTemplateCreateSchema, ../contract/src/ingestion-templates.trpc.ts:12
interface Input {
  organizationId: string;
  sourceType: string;
  displayName: string;
  description?: string;
  iconAsset?: string;
  credentialSchema?: "otlp_token" | "static_api_key" | "agent_id" | null;
  ottlRules?: string;
}
type Output = z.infer<typeof ingestionTemplateSchema>; // ../contract/src/ingestion-template.ts:9

// ingestionTemplates.updateOttlRules
// Input: inline, ../contract/src/ingestion-templates.trpc.ts:40
interface Input {
  organizationId: string;
  id: string;
  ottlRules: string;
}
type Output = z.infer<typeof ingestionTemplateSchema>; // ../contract/src/ingestion-template.ts:9

// ingestionTemplates.archive
type Input = z.infer<typeof templateInOrganization>; // ../contract/src/ingestion-templates.trpc.ts:10
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:8

// ingestionTemplates.cloneFromPlatform
// Input: inline, ../contract/src/ingestion-templates.trpc.ts:48
interface Input {
  organizationId: string;
  sourceTemplateId: string;
}
type Output = z.infer<typeof ingestionTemplateSchema>; // ../contract/src/ingestion-template.ts:9
```

### `personalSessions`

Contract `../contract/src/personal-sessions.trpc.ts:12`, router `src/transport/personal-sessions.trpc.ts:17`.

| Procedure                                         | Kind     | Gate                                                                                                                                    | Input               | Output                       |
| ------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------- |
| `personalSessions.list`                           | query    | Permission `organization:view`                                                                                                          | `organizationScope` | inline                       |
| `personalSessions.revoke`                         | mutation | Permission `organization:view`                                                                                                          | inline              | `cliSessionRevocationSchema` |
| `personalSessions.revokeAll`                      | mutation | Permission `organization:view`                                                                                                          | `organizationScope` | `cliSessionRevocationSchema` |
| `personalSessions.listWebSessions`                | query    | No permission: the caller's own signed-in web sessions, answered for the session's user id alone                                        | inline              | inline                       |
| `personalSessions.revokeWebSession`               | mutation | No permission: the caller ending one of their own sessions, matched on the session's user id; a session that is not theirs ends nothing | inline              | `webSessionsEnded`           |
| `personalSessions.revokeWebSessionsForIdentifier` | mutation | No permission: the caller ending their own sessions, matched on the session's user id; an identifier that is not theirs ends nothing    | inline              | `webSessionsEnded`           |

```typescript
// personalSessions.list
// Input: organizationScope, ../contract/src/personal-sessions.trpc.ts:9
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/personal-sessions.trpc.ts:15
type Output = {
  sessionStartedAtMs: number;
  deviceLabel: string;
  hostname: string | null;
  uname: string | null;
  platform: string | null;
  cliApiKeyId: string | null;
  lastSeenMs: number;
  expiresAtMs: number;
}[];

// personalSessions.revoke
// Input: inline, ../contract/src/personal-sessions.trpc.ts:19
interface Input {
  organizationId: string;
  sessionStartedAtMs: number;
}
// Output: cliSessionRevocationSchema, ../contract/src/cli-sessions.ts:52
interface Output {
  ok: boolean;
  revokedTokens: number;
  revokedKeys: number;
}

// personalSessions.revokeAll
type Input = z.infer<typeof organizationScope>; // ../contract/src/personal-sessions.trpc.ts:9
type Output = z.infer<typeof cliSessionRevocationSchema>; // ../contract/src/cli-sessions.ts:52

// personalSessions.listWebSessions
// Input: inline, ../contract/src/personal-sessions.trpc.ts:28
type Input = Record<string, unknown>;
// Output: inline, ../contract/src/personal-sessions.trpc.ts:29
type Output = {
  sessionId: string;
  identifierId: string | null;
  method: string;
  secondFactorProven: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  signedInAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}[];

// personalSessions.revokeWebSession
// Input: inline, ../contract/src/personal-sessions.trpc.ts:32
interface Input {
  sessionId: string;
}
// Output: webSessionsEnded, ../contract/src/personal-sessions.trpc.ts:10
interface Output {
  ended: number;
}

// personalSessions.revokeWebSessionsForIdentifier
// Input: inline, ../contract/src/personal-sessions.trpc.ts:36
interface Input {
  identifierId: string;
}
type Output = z.infer<typeof webSessionsEnded>; // ../contract/src/personal-sessions.trpc.ts:10
```

### `sessionPolicy`

Contract `../contract/src/session-policy.ts:16`, router `src/transport/session-policy.trpc.ts:9`.

| Procedure                      | Kind     | Gate                             | Input  | Output                            |
| ------------------------------ | -------- | -------------------------------- | ------ | --------------------------------- |
| `sessionPolicy.get`            | query    | Permission `organization:view`   | inline | `organizationSessionPolicySchema` |
| `sessionPolicy.setMaxDuration` | mutation | Permission `organization:manage` | inline | `sessionCeilingAppliedSchema`     |

```typescript
// sessionPolicy.get
// Input: inline, ../contract/src/session-policy.ts:18
interface Input {
  organizationId: string;
}
// Output: organizationSessionPolicySchema, ../contract/src/session-policy.ts:6
interface Output {
  maxSessionDurationDays: number;
}

// sessionPolicy.setMaxDuration
// Input: inline, ../contract/src/session-policy.ts:23
interface Input {
  organizationId: string;
  maxSessionDurationDays: number;
}
// Output: sessionCeilingAppliedSchema, ../contract/src/session-policy.ts:11
interface Output {
  ok: true;
  reapedSessions: number;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `coding_assistant_billing` (aggregate `coding_assistant_billing`)

Declared at `src/eventing/coding-assistant-billing.pipeline.ts:52`. Events: `codingAssistantBillingRecordedEventSchema`.

| Kind    | Name                           | Handles | Declared at                                            |
| ------- | ------------------------------ | ------- | ------------------------------------------------------ |
| command | `recordCodingAssistantBilling` | –       | `src/eventing/coding-assistant-billing.pipeline.ts:57` |

### Pipeline `governance_activity_monitor` (aggregate `global`)

Declared at `src/eventing/governance-activity-monitor.pipeline.ts:64`.

| Kind            | Name                             | Handles                                                                                     | Declared at                                               |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| process manager | `spendSpikeEvaluation`           | every 5 min (`SPEND_SPIKE_EVALUATION_INTERVAL_MS = 5 * 60 * 1000`); intents `pass` (outbox) | `src/eventing/governance-activity-monitor.pipeline.ts:82` |
| process manager | `governanceTraceFacts`           | every 1 min (`GOVERNANCE_TRACE_FACTS_INTERVAL_MS = 60 * 1000`); intents `pass` (outbox)     | `src/eventing/governance-activity-monitor.pipeline.ts:99` |
| peer subscriber | `seedDefaultAiToolCatalog`       | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md) | `src/eventing/governance-activity-monitor.pipeline.ts:70` |
| peer subscriber | `assignScimCostCenterDepartment` | `lw.scim.cost_center_changed` from [scim](../../scim/README.md)                             | `src/eventing/governance-activity-monitor.pipeline.ts:77` |

### Pipeline `ingestion_pull_reconcile` (aggregate `global`)

Declared at `src/eventing/ingestion-pull-reconcile.pipeline.ts:37`.

| Kind            | Name                     | Handles                                                                                     | Declared at                                            |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| process manager | `ingestionPullReconcile` | every 1 min (`INGESTION_PULL_RECONCILE_CHECK_MS = 60 * 1000`); intents `reconcile` (outbox) | `src/eventing/ingestion-pull-reconcile.pipeline.ts:42` |

### Pipeline `ingestion_pull_processing` (aggregate `ingestion_pull`)

Declared at `src/eventing/ingestion-pull.pipeline.ts:102`. Events: `ingestionPullConfiguredEventSchema`, `ingestionPullDisabledEventSchema`, `ingestionPullRunCompletedEventSchema`, `ingestionPullRunFailedEventSchema`, `ingestionPullAgentsListingRequestedEventSchema`, `ingestionPullAgentsListedEventSchema`, `ingestionPullAgentsListingRefusedEventSchema`, `ingestionPullPeopleListingRequestedEventSchema`, `ingestionPullPeopleListedEventSchema`, `ingestionPullPeopleListingRefusedEventSchema`.

| Kind                | Name                                                                             | Handles                                           | Declared at                                   |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| command             | `configure`                                                                      | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:123` |
| command             | `disable`                                                                        | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:124` |
| command             | `recordRunCompleted`                                                             | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:125` |
| command             | `recordRunFailed`                                                                | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:126` |
| command             | `requestAgentsListing`                                                           | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:127` |
| command             | `recordAgentsListed`                                                             | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:128` |
| command             | `recordAgentsListingRefused`                                                     | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:129` |
| command             | `requestPeopleListing`                                                           | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:130` |
| command             | `recordPeopleListed`                                                             | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:131` |
| command             | `recordPeopleListingRefused`                                                     | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:132` |
| process manager     | `ingestionPull`                                                                  | ≈ applier `this.options.process.processManager()` | `src/eventing/ingestion-pull.pipeline.ts:134` |
| Postgres projection | `≈ IngestionPullRunStatusEventingProjection.create(this.options.runStatusStore)` | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:120` |

### Pipeline `pulled_usage_processing` (aggregate `pulled_usage`)

Declared at `src/eventing/pulled-usage.pipeline.ts:156`. Events: `pulledUsageObservedEventSchema`, `pulledUsageRetractedEventSchema`, `pulledUsagePricedEventSchema`.

| Kind                       | Name                      | Handles                                           | Declared at                                 |
| -------------------------- | ------------------------- | ------------------------------------------------- | ------------------------------------------- |
| command                    | `recordPulledUsage`       | –                                                 | `src/eventing/pulled-usage.pipeline.ts:167` |
| command                    | `retractPulledUsage`      | –                                                 | `src/eventing/pulled-usage.pipeline.ts:168` |
| command                    | `recordPulledUsagePriced` | –                                                 | `src/eventing/pulled-usage.pipeline.ts:169` |
| process manager            | `pulledUsageLedger`       | ≈ applier `this.ledger.processManager()`          | `src/eventing/pulled-usage.pipeline.ts:177` |
| process manager            | `costRollupWatch`         | ≈ applier `this.costRollupWatch.processManager()` | `src/eventing/pulled-usage.pipeline.ts:181` |
| ClickHouse fold projection | `≈ this.costRollup`       | –                                                 | `src/eventing/pulled-usage.pipeline.ts:171` |
| ClickHouse map projection  | `≈ this.costCharges`      | –                                                 | `src/eventing/pulled-usage.pipeline.ts:174` |

## Configuration

| Kind   | Leaf                      | Environment variable                  | Declared at                               |
| ------ | ------------------------- | ------------------------------------- | ----------------------------------------- |
| secret | `–`                       | `GOVERNANCE_ERASURE_PSEUDONYM_SECRET` | `src/app/governance.app.ts:465`           |
| config | `gatewayPublicUrl`        | `LW_GATEWAY_PUBLIC_URL`               | `../contract/src/governance.config.ts:33` |
| config | `gatewayInternalUrl`      | `LW_GATEWAY_INTERNAL_URL`             | `../contract/src/governance.config.ts:34` |
| config | `gatewayLegacyUrl`        | `LW_GATEWAY_BASE_URL`                 | `../contract/src/governance.config.ts:35` |
| config | `isSaas`                  | `IS_SAAS`                             | `../contract/src/governance.config.ts:37` |
| config | `publicBaseUrl`           | `BASE_HOST`                           | `../contract/src/governance.config.ts:39` |
| config | `ingestRateLimitDisabled` | `LW_INGEST_RATE_LIMIT_DISABLED`       | `../contract/src/governance.config.ts:41` |

<!-- readme:generated:end -->
