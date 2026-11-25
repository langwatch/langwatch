# @langwatch/enterprise-governance-process

The server half of [governance](../README.md). AI governance: ingestion sources and pulls, cost attribution, anomaly rules and alerts, tool and session policies, departments, and the CLI's budget and virtual-key reads.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("governance").withRepositories(governanceRepositories).withApi(GovernanceModule).withTransports(governanceRest, agentRegistryRest, agentKillSwitchRest, ocsfSiemRest, governanceCliRest, governanceIngestRest, meUsageRest, departmentsTrpcTransport, ingestionTemplatesTrpcTransport, aiToolsTrpcTransport, ingestionSourcesTrpcTransport, governanceTrpcTransport, anomalyRulesTrpcTransport, activityMonitorTrpcTransport, governanceKillSwitchTrpcTransport, personalSessionsTrpcTransport, ingestionKeyTrpcTransport, sessionPolicyTrpcTransport, governancePeopleTrpcTransport, governanceAgentsTrpcTransport, governanceRegistryTrpcTransport, governanceCostTrpcTransport).provideMiddlewareBindings(…).provideMiddlewareContext(…).withEventing(pulledUsageEventing).withEventing(ingestionPullEventing).withEventing(ingestionPullReconcileEventing).withEventing(governanceActivityMonitorEventing).withEventing(codingAssistantBillingEventing).withEventing(ingestionSourceLifecycleEventing).withEventing(agentRegistryEventing).withEventing(agentStopEventing).withEventing(ocsfPushEventing).withMigrations(…)`, `src/governance.module.ts:79`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`GovernanceRestApi`)

The ingestion-template operations the governance REST family calls.

Peers call these through the token, declared at `../contract/src/governance.api.ts:215`; nothing else in this package is public.

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

#### `templateGetByIdForMember`

The member shape, at `aiTools:view`: `ottlRules` is empty, as in `templateListForUser`.

```typescript
templateGetByIdForMember(input: { id: string; organizationId: string; }): Promise<IngestionTemplate>;
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

#### `ingestionSourceTestAgentListing`

Lists the provider's agents for an unsaved configuration, recording nothing.

```typescript
ingestionSourceTestAgentListing(input: TestAgentListingInput): Promise<TestAgentListingResult>;
```

#### `ingestionSourceTestAgentListingForSource`

Lists a saved source's agents, recording nothing; another organisation's source is a 404.

```typescript
ingestionSourceTestAgentListingForSource(input: { organizationId: string; sourceId: string; }): Promise<TestAgentListingResult>;
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

#### `getActorWorkspace`

```typescript
getActorWorkspace(input: { organizationId: string; actor: string; }): Promise<GovernanceActorWorkspaceLookup>;
```

#### `departmentList`

```typescript
departmentList(input: { organizationId: string }): Promise<Department[]>;
```

#### `departmentAssignments`

```typescript
departmentAssignments(input: { organizationId: string; callerUserId: string | null; }): Promise<DepartmentAssignments>;
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

#### `listRegistryAgents`

The organisation's agent registry, a page at a time (specs/agent-registry.feature).

```typescript
listRegistryAgents(input: { organizationId: string; limit: number; cursor?: string; updatedSince?: string; status?: AgentRegistryStatus; posture?: AgentRegistryPosture; }): Promise<AgentRegistryPage>;
```

#### `getRegistryAgent`

Throws `agent_registry_entry_not_found` for an id outside the organisation.

```typescript
getRegistryAgent(input: { organizationId: string; id: string }): Promise<AgentRegistryEntry>;
```

#### `listRegistryAgentVersions`

One agent's changes after a sequence, oldest first; each carries the entry at its version.

```typescript
listRegistryAgentVersions(input: { organizationId: string; id: string; cursor?: string; limit: number; }): Promise<AgentRegistryEventPage>;
```

#### `listRegistryEvents`

The organisation's change feed after a sequence, in order.

```typescript
listRegistryEvents(input: { organizationId: string; after?: string; limit: number; }): Promise<AgentRegistryEventPage>;
```

#### `getRegistryArdManifest`

```typescript
getRegistryArdManifest(input: { organizationId: string }): Promise<ArdManifest>;
```

#### `searchRegistryArd`

```typescript
searchRegistryArd(input: { organizationId: string; request: ArdSearchRequest; }): Promise<ArdSearchResponse>;
```

#### `getRegistrySettings`

The organisation's dormancy window; 30 days until it saves one.

```typescript
getRegistrySettings(input: { organizationId: string }): Promise<AgentRegistrySettings>;
```

#### `saveRegistrySettings`

```typescript
saveRegistrySettings(input: { organizationId: string; dormantAfterDays: number; }): Promise<AgentRegistrySettings>;
```

#### `findAgentKillSwitchSummaries`

```typescript
findAgentKillSwitchSummaries(input: { organizationId: string; }): Promise<AgentKillSwitchSummary[]>;
```

#### `findPendingAgentStops`

```typescript
findPendingAgentStops(input: { organizationId: string }): Promise<AgentStopView[]>;
```

#### `getAgentStopPlan`

Throws `agent_registry_entry_not_found` for an agent outside the organisation.

```typescript
getAgentStopPlan(input: { organizationId: string; agentId: string }): Promise<AgentStopPlan>;
```

#### `setAgentStopPlan`

Throws `agent_stop_target_invalid` for a target the organisation does not hold, and `agent_stop_plan_conflict` when `expectedVersion` is given and the plan was saved since. Writes one audit row naming the agent and `caller`, refused saves included.

```typescript
setAgentStopPlan(input: { organizationId: string; agentId: string; targets: readonly AgentStopTarget[]; expectedVersion?: number; caller: AgentStopCaller; }): Promise<AgentStopPlan>;
```

#### `findAwsConnections`

```typescript
findAwsConnections(input: { organizationId: string }): Promise<AwsConnectionView[]>;
```

#### `createAwsConnection`

Writes an audit row naming `userId`, the person who added it.

```typescript
createAwsConnection(input: { organizationId: string; connection: AwsConnectionInput; userId: string | null; /** The operator behind an impersonated person, recorded beside `userId`. */ impersonatorId?: string; }): Promise<AwsConnectionView>;
```

#### `deleteAwsConnection`

Throws `governance_aws_connection_in_use` while a plan target or unrestored stop uses it; a delete that removed a connection writes an audit row naming `userId`.

```typescript
deleteAwsConnection(input: { organizationId: string; connectionId: string; userId: string | null; /** The operator behind an impersonated person, recorded beside `userId`. */ impersonatorId?: string; }): Promise<{ deleted: boolean }>;
```

#### `requestAgentStop`

```typescript
requestAgentStop(input: { organizationId: string; agentId: string; reason: string; severity: AgentStopSeverity; /** Throws `agent_stop_plan_changed` when given and the plan no longer holds exactly these. */ expectedTargetIds?: readonly string[]; caller: AgentStopCaller; }): Promise<AgentStopView>;
```

#### `approveAgentStop`

```typescript
approveAgentStop(input: { organizationId: string; stopId: string; note?: string; /** Throws `agent_stop_plan_changed` when given and the stop no longer holds exactly these. */ expectedTargetIds?: readonly string[]; caller: AgentStopCaller; }): Promise<AgentStopView>;
```

#### `denyAgentStop`

```typescript
denyAgentStop(input: { organizationId: string; stopId: string; note?: string; caller: AgentStopCaller; }): Promise<AgentStopView>;
```

#### `restoreAgentStop`

```typescript
restoreAgentStop(input: { organizationId: string; stopId: string; caller: AgentStopCaller; }): Promise<AgentStopView>;
```

#### `retryAgentStop`

Applies again every target the stop has not stopped, plus plan targets added since; throws `agent_stop_not_retryable` unless the stop is quarantined, stop_failed or restore_failed.

```typescript
retryAgentStop(input: { organizationId: string; stopId: string; caller: AgentStopCaller; }): Promise<AgentStopView>;
```

#### `getLatestAgentStop`

The agent's latest stop; throws `agent_stop_not_found` when it was never stopped.

```typescript
getLatestAgentStop(input: { organizationId: string; agentId: string }): Promise<AgentStopView>;
```

#### `listAgentStops`

Latest request first, `limit` at a time; a cursor it never returned is a validation error.

```typescript
listAgentStops(input: { organizationId: string; statuses?: readonly AgentStopStatus[]; limit: number; cursor?: string; }): Promise<AgentStopPage>;
```

#### `listOcsfEvents`

The organisation's governance events as OCSF 1.9.0, after the cursor.

```typescript
listOcsfEvents(input: OcsfExportWindow & { sourceType?: string; sourceId?: string }): Promise<OcsfEventsPage>;
```

#### `listOcsfProjectTraces`

The organisation's project traces as OCSF 1.9.0, one event per trace.

```typescript
listOcsfProjectTraces(input: OcsfExportWindow & { projectId?: string }): Promise<OcsfEventsPage>;
```

#### `listOcsfAudit`

The organisation's audit log as OCSF 1.9.0, oldest first.

```typescript
listOcsfAudit(input: OcsfExportWindow): Promise<OcsfEventsPage>;
```

#### `ingestOcsfEvents`

Stores OCSF events another source sent; one row per (source, metadata.uid).

```typescript
ingestOcsfEvents(input: OcsfIngestRequest & { organizationId: string }): Promise<OcsfIngestResponse>;
```

#### `securityLakeSourceCreate`

```typescript
securityLakeSourceCreate(input: SecurityLakeSourceCreateInput & { organizationId: string; actorUserId: string | null }): Promise<SecurityLakeSource>;
```

#### `securityLakeSourceUpdate`

```typescript
securityLakeSourceUpdate(input: SecurityLakeSourceUpdateInput & { id: string; organizationId: string }): Promise<SecurityLakeSource>;
```

#### `securityLakeSourceGet`

The source with the external id LangWatch generated, for the trust policy.

```typescript
securityLakeSourceGet(input: { id: string; organizationId: string }): Promise<SecurityLakeSource>;
```

#### `securityLakeSourceTest`

```typescript
securityLakeSourceTest(input: SecurityLakeConnectionTestInput & { id: string; organizationId: string }): Promise<SecurityLakeConnectionTest>;
```

#### `securityLakeSourceHealth`

```typescript
securityLakeSourceHealth(input: { id: string; organizationId: string; }): Promise<SecurityLakeSourceHealth>;
```

#### `securityLakeCallersWithoutTraces`

```typescript
securityLakeCallersWithoutTraces(input: { organizationId: string }): Promise<SecurityLakeCallers>;
```

## REST transport

### `agentKillSwitchRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/agent-kill-switch.rest.ts:50` |
| Base URL    | none: each route's path is its address       |
| Addressing  | literal                                      |
| Credential  | organization                                 |

#### `GET /api/governance/agents/:agentId/stop-plan` · `getAgentStopPlan`

Get an agent's stop plan

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-kill-switch.rest.ts:57`.

Answers at `/api/governance/agents/:agentId/stop-plan`, `/api/v1/governance/agents/:agentId/stop-plan`.

```typescript
// Params: agentStopAgentParamsSchema, ../contract/src/features/kill-switch/agent-kill-switch.ts:308
interface Params {
  agentId: string;
}
type Response = z.infer<typeof agentStopPlanResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:332
```

#### `PUT /api/governance/agents/:agentId/stop-plan` · `setAgentStopPlan`

Replace an agent's stop plan

Permission `governance:manage`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Credential `organization`. Declared at `src/transport/agent-kill-switch.rest.ts:78`.

Answers at `/api/governance/agents/:agentId/stop-plan`, `/api/v1/governance/agents/:agentId/stop-plan`.

```typescript
type Params = z.infer<typeof agentStopAgentParamsSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:308
type Body = z.infer<typeof setAgentStopPlanInputSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:89
type Response = z.infer<typeof agentStopPlanResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:332
```

#### `POST /api/governance/agents/:agentId/stop` · `requestAgentStop`

Stop an agent

Permission `governance:manage`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Credential `organization`. Declared at `src/transport/agent-kill-switch.rest.ts:110`.

Answers at `/api/governance/agents/:agentId/stop`, `/api/v1/governance/agents/:agentId/stop`.

```typescript
type Params = z.infer<typeof agentStopAgentParamsSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:308
// Body: requestAgentStopInputSchema, ../contract/src/features/kill-switch/agent-kill-switch.ts:263
interface Body {
  reason: string;
  severity?: "low" | "medium" | "high" | "critical";
  expectedTargetIds?: string[];
}
type Response = z.infer<typeof agentStopResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:336
```

#### `GET /api/governance/agents/:agentId/stop` · `getLatestAgentStop`

Get an agent's latest stop

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-kill-switch.rest.ts:144`.

Answers at `/api/governance/agents/:agentId/stop`, `/api/v1/governance/agents/:agentId/stop`.

```typescript
type Params = z.infer<typeof agentStopAgentParamsSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:308
type Response = z.infer<typeof agentStopResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:336
```

#### `GET /api/governance/agent-stops` · `listAgentStops`

List the organisation's agent stops

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-kill-switch.rest.ts:165`.

Answers at `/api/governance/agent-stops`, `/api/v1/governance/agent-stops`.

```typescript
type Query = z.infer<typeof agentStopListQuerySchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:325
type Response = z.infer<typeof agentStopListResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:347
```

#### `POST /api/governance/agent-stops/:stopId/approve` · `approveAgentStop`

Approve a pending stop

Permission `governance:manage`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Credential `organization`. Declared at `src/transport/agent-kill-switch.rest.ts:187`.

Answers at `/api/governance/agent-stops/:stopId/approve`, `/api/v1/governance/agent-stops/:stopId/approve`.

```typescript
// Params: agentStopParamsSchema, ../contract/src/features/kill-switch/agent-kill-switch.ts:312
interface Params {
  stopId: string;
}
// Body: approveAgentStopInputSchema, ../contract/src/features/kill-switch/agent-kill-switch.ts:283
interface Body {
  note?: string;
  expectedTargetIds?: string[];
}
type Response = z.infer<typeof agentStopResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:336
```

#### `POST /api/governance/agent-stops/:stopId/deny` · `denyAgentStop`

Deny a pending stop

Permission `governance:manage`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Credential `organization`. Declared at `src/transport/agent-kill-switch.rest.ts:219`.

Answers at `/api/governance/agent-stops/:stopId/deny`, `/api/v1/governance/agent-stops/:stopId/deny`.

```typescript
type Params = z.infer<typeof agentStopParamsSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:312
// Body: decideAgentStopInputSchema, ../contract/src/features/kill-switch/agent-kill-switch.ts:272
interface Body {
  note?: string;
}
type Response = z.infer<typeof agentStopResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:336
```

#### `POST /api/governance/agent-stops/:stopId/restore` · `restoreAgentStop`

Restore a stopped agent

Permission `governance:manage`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Credential `organization`. Declared at `src/transport/agent-kill-switch.rest.ts:250`.

Answers at `/api/governance/agent-stops/:stopId/restore`, `/api/v1/governance/agent-stops/:stopId/restore`.

```typescript
type Params = z.infer<typeof agentStopParamsSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:312
// Body: restoreAgentStopInputSchema, ../contract/src/features/kill-switch/agent-kill-switch.ts:299
type Body = Record<string, unknown>;
type Response = z.infer<typeof agentStopResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:336
```

#### `POST /api/governance/agent-stops/:stopId/retry` · `retryAgentStop`

Retry a stop

Permission `governance:manage`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Credential `organization`. Declared at `src/transport/agent-kill-switch.rest.ts:281`.

Answers at `/api/governance/agent-stops/:stopId/retry`, `/api/v1/governance/agent-stops/:stopId/retry`.

```typescript
type Params = z.infer<typeof agentStopParamsSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:312
// Body: retryAgentStopInputSchema, ../contract/src/features/kill-switch/agent-kill-switch.ts:291
type Body = Record<string, unknown>;
type Response = z.infer<typeof agentStopResponseSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:336
```

### `agentRegistryRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/agent-registry.rest.ts:40` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | organization                              |

#### `GET /api/governance/registry/agents` · `listRegistryAgents`

List the organisation's agent registry

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:47`.

Answers at `/api/governance/registry/agents`, `/api/v1/governance/registry/agents`.

```typescript
// Query: agentRegistryListQuerySchema, ../contract/src/features/registry/agent-registry.ts:193
interface Query {
  limit?: number;
  cursor?: string;
  updated_since?: string;
  status?: "active" | "removed";
  posture?: "governed" | "shadow" | "dormant";
}
type Response = z.infer<typeof agentRegistryListResponseSchema>; // ../contract/src/features/registry/agent-registry.ts:203
```

#### `GET /api/governance/registry/agents/:agentId` · `getRegistryAgent`

Get one registry agent

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:71`.

Answers at `/api/governance/registry/agents/:agentId`, `/api/v1/governance/registry/agents/:agentId`.

```typescript
// Params: agentRegistryParamsSchema, ../contract/src/features/registry/agent-registry.ts:211
interface Params {
  agentId: string;
}
type Response = z.infer<typeof agentRegistryDetailResponseSchema>; // ../contract/src/features/registry/agent-registry.ts:218
```

#### `GET /api/governance/registry/agents/:agentId/versions` · `listRegistryAgentVersions`

List one registry agent's versions

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:92`.

Answers at `/api/governance/registry/agents/:agentId/versions`, `/api/v1/governance/registry/agents/:agentId/versions`.

```typescript
type Params = z.infer<typeof agentRegistryParamsSchema>; // ../contract/src/features/registry/agent-registry.ts:211
// Query: agentRegistryEventsQuerySchema, ../contract/src/features/registry/agent-registry.ts:238
interface Query {
  limit?: number;
  cursor?: string;
}
type Response = z.infer<typeof agentRegistryEventsResponseSchema>; // ../contract/src/features/registry/agent-registry.ts:249
```

#### `GET /api/governance/registry/events` · `listRegistryEvents`

Read the registry change feed

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:119`.

Answers at `/api/governance/registry/events`, `/api/v1/governance/registry/events`.

```typescript
type Query = z.infer<typeof agentRegistryEventsQuerySchema>; // ../contract/src/features/registry/agent-registry.ts:238
type Response = z.infer<typeof agentRegistryEventsResponseSchema>; // ../contract/src/features/registry/agent-registry.ts:249
```

#### `GET /api/governance/registry/schema` · `getRegistrySchema`

Get the registry's JSON Schemas

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:140`.

Answers at `/api/governance/registry/schema`, `/api/v1/governance/registry/schema`.

```typescript
// Response: agentRegistrySchemaResponseSchema, ../contract/src/features/registry/agent-registry.ts:261
interface Response {
  entry: Record<string, unknown>;
  event: Record<string, unknown>;
}
```

#### `GET /api/governance/registry/ard.json` · `getRegistryArdManifest`

Get the registry as an ARD manifest

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:154`.

Answers at `/api/governance/registry/ard.json`, `/api/v1/governance/registry/ard.json`.

```typescript
type Response = z.infer<typeof ardManifestSchema>; // ../contract/src/features/registry/agent-registry-ard.ts:41
```

#### `POST /api/governance/registry/ard/search` · `searchRegistryArd`

Search the registry (ARD search)

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:168`.

Answers at `/api/governance/registry/ard/search`, `/api/v1/governance/registry/ard/search`.

```typescript
// Body: ardSearchRequestSchema, ../contract/src/features/registry/agent-registry-ard.ts:55
interface Body {
  query: {
    text: string;
    filter?: Record<string, string | string[]>;
  };
  federation?: "auto" | "referrals" | "none";
  pageSize?: number;
  pageToken?: string;
}
type Response = z.infer<typeof ardSearchResponseSchema>; // ../contract/src/features/registry/agent-registry-ard.ts:70
```

#### `GET /api/governance/registry/settings` · `getRegistrySettings`

Get the registry settings

Permission `governance:view`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:187`.

Answers at `/api/governance/registry/settings`, `/api/v1/governance/registry/settings`.

```typescript
// Response: agentRegistrySettingsResponseSchema, ../contract/src/features/registry/agent-registry-settings.ts:39
interface Response {
  data: {
    dormant_after_days: number;
  };
}
```

#### `PUT /api/governance/registry/settings` · `saveRegistrySettings`

Save the registry settings

Permission `ingestionSources:manage`. Entitlement `enterprise` (feature `AGENT_REGISTRY`). Declared at `src/transport/agent-registry.rest.ts:203`.

Answers at `/api/governance/registry/settings`, `/api/v1/governance/registry/settings`.

```typescript
// Body: agentRegistrySettingsSchema, ../contract/src/features/registry/agent-registry-settings.ts:29
interface Body {
  dormant_after_days: number;
}
type Response = z.infer<typeof agentRegistrySettingsResponseSchema>; // ../contract/src/features/registry/agent-registry-settings.ts:39
```

### `governanceCliRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/governance-cli.rest.ts:37` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | cli_token                                 |

#### `GET /api/auth/cli/budget/status` · `readCliBudgetStatus`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:42`.

Answers at `/api/auth/cli/budget/status`, `/api/v1/auth/cli/budget/status`.

#### `GET /api/auth/cli/bootstrap` · `readCliBootstrap`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:48`.

Answers at `/api/auth/cli/bootstrap`, `/api/v1/auth/cli/bootstrap`.

#### `GET /api/auth/cli/budget-overview` · `readCliBudgetOverview`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:54`.

Answers at `/api/auth/cli/budget-overview`, `/api/v1/auth/cli/budget-overview`.

#### `GET /api/auth/cli/personal-project` · `readCliPersonalProject`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:60`.

Answers at `/api/auth/cli/personal-project`, `/api/v1/auth/cli/personal-project`.

#### `POST /api/auth/cli/project-key` · `readCliProjectKey`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:68`.

Answers at `/api/auth/cli/project-key`, `/api/v1/auth/cli/project-key`.

```typescript
// Rawbody: "text" (inline, src/transport/governance-cli.rest.ts:71)
```

#### `POST /api/auth/cli/virtual-key` · `issueCliVirtualKey`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:82`.

Answers at `/api/auth/cli/virtual-key`, `/api/v1/auth/cli/virtual-key`.

```typescript
// Rawbody: "text" (inline, src/transport/governance-cli.rest.ts:85)
```

#### `GET /api/auth/cli/governance/ingest/sources` · `listCliIngestionSources`

Permission `ingestionSources:view`. Entitlement `enterprise` (feature `INGESTION_SOURCES`). Declared at `src/transport/governance-cli.rest.ts:91`.

Answers at `/api/auth/cli/governance/ingest/sources`, `/api/v1/auth/cli/governance/ingest/sources`.

```typescript
// Query: governanceCliSourcesQuerySchema, ../contract/src/features/cli/governance-cli-rest.schemas.ts:78
interface Query {
  include_archived?: string;
}
```

#### `GET /api/auth/cli/governance/ingest/sources/:sourceId/events` · `listCliIngestionSourceEvents`

Permission `activityMonitor:view`. Entitlement `enterprise` (feature `ACTIVITY_MONITOR`). Declared at `src/transport/governance-cli.rest.ts:104`.

Answers at `/api/auth/cli/governance/ingest/sources/:sourceId/events`, `/api/v1/auth/cli/governance/ingest/sources/:sourceId/events`.

```typescript
// Params: governanceCliSourceParamsSchema, ../contract/src/features/cli/governance-cli-rest.schemas.ts:58
interface Params {
  sourceId: string;
}
// Query: governanceCliSourceEventsQuerySchema, ../contract/src/features/cli/governance-cli-rest.schemas.ts:102
interface Query {
  limit?: string;
  before_iso?: string;
}
```

#### `GET /api/auth/cli/governance/ingest/sources/:sourceId/health` · `readCliIngestionSourceHealth`

Permission `activityMonitor:view`. Entitlement `enterprise` (feature `ACTIVITY_MONITOR`). Declared at `src/transport/governance-cli.rest.ts:122`.

Answers at `/api/auth/cli/governance/ingest/sources/:sourceId/health`, `/api/v1/auth/cli/governance/ingest/sources/:sourceId/health`.

```typescript
type Params = z.infer<typeof governanceCliSourceParamsSchema>; // ../contract/src/features/cli/governance-cli-rest.schemas.ts:58
```

#### `GET /api/auth/cli/governance/status` · `readCliGovernanceStatus`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Entitlement `enterprise` (feature `INGESTION_SOURCES`). Declared at `src/transport/governance-cli.rest.ts:135`.

Answers at `/api/auth/cli/governance/status`, `/api/v1/auth/cli/governance/status`.

#### `GET /api/auth/cli/governance/ingestion-templates` · `listCliIngestionTemplates`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:142`.

Answers at `/api/auth/cli/governance/ingestion-templates`, `/api/v1/auth/cli/governance/ingestion-templates`.

#### `POST /api/auth/cli/governance/ingestion-key` · `mintCliIngestionKey`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:148`.

Answers at `/api/auth/cli/governance/ingestion-key`, `/api/v1/auth/cli/governance/ingestion-key`.

```typescript
// Rawbody: "text" (inline, src/transport/governance-cli.rest.ts:151)
```

#### `GET /api/auth/cli/governance/ingestion-keys` · `listCliIngestionKeys`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:157`.

Answers at `/api/auth/cli/governance/ingestion-keys`, `/api/v1/auth/cli/governance/ingestion-keys`.

#### `GET /api/auth/cli/governance/ingestion-keys/:lookup_id` · `readCliIngestionKeyState`

Authenticated: the CLI bearer is one user's device session; every route answers for that user's own seat and the minting routes refuse an inactive seat. Declared at `src/transport/governance-cli.rest.ts:163`.

Answers at `/api/auth/cli/governance/ingestion-keys/:lookup_id`, `/api/v1/auth/cli/governance/ingestion-keys/:lookup_id`.

```typescript
// Params: governanceCliKeyLookupParamsSchema, ../contract/src/features/cli/governance-cli-rest.schemas.ts:65
interface Params {
  lookup_id: string;
}
```

### `governanceIngestRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/governance-ingest.rest.ts:31` |
| Base URL    | none: each route's path is its address       |
| Addressing  | literal                                      |
| Credential  | project                                      |

#### `POST /api/ingest/otel/:sourceId` · `ingestSourceOtlpTraces`

Public: an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body. Hidden from the OpenAPI document. Declared at `src/transport/governance-ingest.rest.ts:36`.

Answers at `/api/ingest/otel/:sourceId`, `/api/v1/ingest/otel/:sourceId`.

```typescript
// Params: governanceIngestSourceParamsSchema, ../contract/src/features/ingestion/governance-ingest-rest.schemas.ts:15
interface Params {
  sourceId: string;
}
// Rawbody: "bytes" (inline, src/transport/governance-ingest.rest.ts:40)
type Headers = z.infer<typeof governanceIngestHeadersSchema>; // ../contract/src/features/ingestion/governance-ingest-rest.schemas.ts:47
```

#### `POST /api/ingest/webhook/:sourceId` · `ingestSourceWebhook`

Public: an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body. Hidden from the OpenAPI document. Declared at `src/transport/governance-ingest.rest.ts:51`.

Answers at `/api/ingest/webhook/:sourceId`, `/api/v1/ingest/webhook/:sourceId`.

```typescript
type Params = z.infer<typeof governanceIngestSourceParamsSchema>; // ../contract/src/features/ingestion/governance-ingest-rest.schemas.ts:15
// Rawbody: "text" (inline, src/transport/governance-ingest.rest.ts:55)
type Headers = z.infer<typeof governanceIngestHeadersSchema>; // ../contract/src/features/ingestion/governance-ingest-rest.schemas.ts:47
```

#### `POST /api/ingest/otel/:sourceId/v1/logs` · `ingestSourceOtlpLogs`

Public: an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body. Hidden from the OpenAPI document. Declared at `src/transport/governance-ingest.rest.ts:66`.

Answers at `/api/ingest/otel/:sourceId/v1/logs`.

```typescript
type Params = z.infer<typeof governanceIngestSourceParamsSchema>; // ../contract/src/features/ingestion/governance-ingest-rest.schemas.ts:15
// Rawbody: "bytes" (inline, src/transport/governance-ingest.rest.ts:70)
type Headers = z.infer<typeof governanceIngestHeadersSchema>; // ../contract/src/features/ingestion/governance-ingest-rest.schemas.ts:47
```

#### `POST /api/ingest/otel/:sourceId/v1/metrics` · `ingestSourceOtlpMetrics`

Public: an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body. Hidden from the OpenAPI document. Declared at `src/transport/governance-ingest.rest.ts:81`.

Answers at `/api/ingest/otel/:sourceId/v1/metrics`.

```typescript
type Params = z.infer<typeof governanceIngestSourceParamsSchema>; // ../contract/src/features/ingestion/governance-ingest-rest.schemas.ts:15
// Rawbody: "bytes" (inline, src/transport/governance-ingest.rest.ts:85)
type Headers = z.infer<typeof governanceIngestHeadersSchema>; // ../contract/src/features/ingestion/governance-ingest-rest.schemas.ts:47
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
type Response = z.infer<typeof governanceRestTemplateListSchema>; // ../contract/src/governance-rest.schemas.ts:84
```

#### `GET /ingestion-templates/admin` · `listIngestionTemplatesForAdmin`

List ingestion templates (admin shape, includes OTTL)

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:130`.

Answers at `/api/governance/ingestion-templates/admin`, `/api/v1/governance/ingestion-templates/admin`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/admin`, `/api/v1/governance/2026-08-07/ingestion-templates/admin`, `/api/governance/latest/ingestion-templates/admin`, `/api/v1/governance/latest/ingestion-templates/admin`.

```typescript
type Response = z.infer<typeof governanceRestTemplateListSchema>; // ../contract/src/governance-rest.schemas.ts:84
```

#### `GET /ingestion-templates/:ingestionTemplateId` · `getIngestionTemplate`

Get ingestion template

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:153`.

Answers at `/api/governance/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/ingestion-templates/:ingestionTemplateId`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/2026-08-07/ingestion-templates/:ingestionTemplateId`, `/api/governance/latest/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/latest/ingestion-templates/:ingestionTemplateId`.

```typescript
// Params: governanceRestTemplateParamsSchema, ../contract/src/governance-rest.schemas.ts:75
interface Params {
  ingestionTemplateId: string;
}
type Response = z.infer<typeof governanceRestTemplateDetailSchema>; // ../contract/src/governance-rest.schemas.ts:93
```

#### `POST /ingestion-templates` · `createIngestionTemplate`

Create org-authored ingestion template

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:176`.

Answers at `/api/governance/ingestion-templates`, `/api/v1/governance/ingestion-templates`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates`, `/api/v1/governance/2026-08-07/ingestion-templates`, `/api/governance/latest/ingestion-templates`, `/api/v1/governance/latest/ingestion-templates`.

```typescript
// Body: governanceRestCreateTemplateSchema, ../contract/src/governance-rest.schemas.ts:48
interface Body {
  source_type: string;
  display_name: string;
  description?: string;
  icon_asset?: string;
  credential_schema?: "otlp_token" | "static_api_key" | "agent_id" | null;
  ottl_rules?: string;
}
type Response = z.infer<typeof governanceRestTemplateDetailSchema>; // ../contract/src/governance-rest.schemas.ts:93
```

#### `PATCH /ingestion-templates/:ingestionTemplateId/ottl-rules` · `updateIngestionTemplateOttlRules`

Replace ottl_rules on an org-authored template

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:215`.

Answers at `/api/governance/ingestion-templates/:ingestionTemplateId/ottl-rules`, `/api/v1/governance/ingestion-templates/:ingestionTemplateId/ottl-rules`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/:ingestionTemplateId/ottl-rules`, `/api/v1/governance/2026-08-07/ingestion-templates/:ingestionTemplateId/ottl-rules`, `/api/governance/latest/ingestion-templates/:ingestionTemplateId/ottl-rules`, `/api/v1/governance/latest/ingestion-templates/:ingestionTemplateId/ottl-rules`.

```typescript
type Params = z.infer<typeof governanceRestTemplateParamsSchema>; // ../contract/src/governance-rest.schemas.ts:75
// Body: governanceRestUpdateOttlRulesSchema, ../contract/src/governance-rest.schemas.ts:57
interface Body {
  ottl_rules: string;
}
type Response = z.infer<typeof governanceRestTemplateDetailSchema>; // ../contract/src/governance-rest.schemas.ts:93
```

#### `DELETE /ingestion-templates/:ingestionTemplateId` · `archiveIngestionTemplate`

Soft-archive an org-authored template

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:240`.

Answers at `/api/governance/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/ingestion-templates/:ingestionTemplateId`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/2026-08-07/ingestion-templates/:ingestionTemplateId`, `/api/governance/latest/ingestion-templates/:ingestionTemplateId`, `/api/v1/governance/latest/ingestion-templates/:ingestionTemplateId`.

```typescript
type Params = z.infer<typeof governanceRestTemplateParamsSchema>; // ../contract/src/governance-rest.schemas.ts:75
// Response: governanceRestTemplateArchivedSchema, ../contract/src/governance-rest.schemas.ts:100
interface Response {
  archived: true;
}
```

#### `POST /ingestion-templates/clone` · `cloneIngestionTemplate`

Clone a platform-published template into the caller's org

Permission `aiTools:manage`. Declared at `src/transport/governance.rest.ts:264`.

Answers at `/api/governance/ingestion-templates/clone`, `/api/v1/governance/ingestion-templates/clone`; also, undocumented, `/api/governance/2026-08-07/ingestion-templates/clone`, `/api/v1/governance/2026-08-07/ingestion-templates/clone`, `/api/governance/latest/ingestion-templates/clone`, `/api/v1/governance/latest/ingestion-templates/clone`.

```typescript
// Body: governanceRestCloneTemplateSchema, ../contract/src/governance-rest.schemas.ts:66
interface Body {
  source_template_id: string;
}
type Response = z.infer<typeof governanceRestTemplateDetailSchema>; // ../contract/src/governance-rest.schemas.ts:93
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
// Query: meUsageQuerySchema, ../contract/src/features/personal/personal-usage.ts:135
interface Query {
  windowStartMs?: number;
  windowEndMs?: number;
}
type Response = z.infer<typeof meUsageResponseSchema>; // ../contract/src/features/personal/personal-usage.ts:168
```

### `ocsfSiemRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/ocsf-siem.rest.ts:40`   |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | organization                           |

#### `GET /api/governance/ocsf/events` · `listOcsfEvents`

Export governance events as OCSF 1.9.0

Permission `complianceExport:view`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:47`.

Answers at `/api/governance/ocsf/events`, `/api/v1/governance/ocsf/events`.

```typescript
// Query: ocsfEventsQuerySchema, ../contract/src/features/ocsf/ocsf-siem.ts:102
interface Query {
  limit?: number;
  since?: string;
  until?: string;
  cursor?: string;
  source_type?: string;
  source_id?: string;
}
// Response: ocsfEventsPageSchema, ../contract/src/features/ocsf/ocsf-siem.ts:137
interface Response {
  ocsf_version: string;
  data: Record<string, unknown>[];
  next_cursor: string;
  has_more: boolean;
}
```

#### `GET /api/governance/ocsf/traces` · `listOcsfProjectTraces`

Export project traces as OCSF 1.9.0

Permission `complianceExport:view`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:71`.

Answers at `/api/governance/ocsf/traces`, `/api/v1/governance/ocsf/traces`.

```typescript
// Query: ocsfTracesQuerySchema, ../contract/src/features/ocsf/ocsf-siem.ts:111
interface Query {
  limit?: number;
  since?: string;
  until?: string;
  cursor?: string;
  project_id?: string;
}
type Response = z.infer<typeof ocsfEventsPageSchema>; // ../contract/src/features/ocsf/ocsf-siem.ts:137
```

#### `GET /api/governance/ocsf/audit` · `listOcsfAudit`

Export the audit log as OCSF 1.9.0

Permission `complianceExport:view`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:94`.

Answers at `/api/governance/ocsf/audit`, `/api/v1/governance/ocsf/audit`.

```typescript
// Query: ocsfAuditQuerySchema, ../contract/src/features/ocsf/ocsf-siem.ts:119
interface Query {
  limit?: number;
  since?: string;
  until?: string;
  cursor?: string;
}
type Response = z.infer<typeof ocsfEventsPageSchema>; // ../contract/src/features/ocsf/ocsf-siem.ts:137
```

#### `POST /api/governance/ocsf/ingest` · `ingestOcsfEvents`

Push OCSF events in from another source

Permission `governance:manage`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:116`.

Answers at `/api/governance/ocsf/ingest`, `/api/v1/governance/ocsf/ingest`.

```typescript
type Body = z.infer<typeof ocsfIngestRequestSchema>; // ../contract/src/features/ocsf/ocsf-siem.ts:183
// Response: ocsfIngestResponseSchema, ../contract/src/features/ocsf/ocsf-siem.ts:194
interface Response {
  accepted: number;
}
```

#### `POST /api/governance/security-lake/sources` · `createSecurityLakeSource`

Add an AWS Security Lake source

Permission `ingestionSources:manage`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:134`.

Answers at `/api/governance/security-lake/sources`, `/api/v1/governance/security-lake/sources`.

```typescript
type Body = z.infer<typeof securityLakeSourceCreateInputSchema>; // ../contract/src/features/ocsf/security-lake.ts:116
// Response: securityLakeSourceSchema, ../contract/src/features/ocsf/security-lake.ts:154
interface Response {
  id: string;
  name: string;
  status: string;
  region: string;
  queueUrl: string;
  subscriberRoleArn: string;
  externalId: string;
  sources: ("CLOUD_TRAIL_MGMT" | "S3_DATA" | "LAMBDA_EXECUTION")[];
  schedule: string | null;
}
```

#### `PATCH /api/governance/security-lake/sources/:sourceId` · `updateSecurityLakeSource`

Edit an AWS Security Lake source

Permission `ingestionSources:manage`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:158`.

Answers at `/api/governance/security-lake/sources/:sourceId`, `/api/v1/governance/security-lake/sources/:sourceId`.

```typescript
// Params: sourceParams, src/transport/ocsf-siem.rest.ts:33
interface Params {
  sourceId: string;
}
type Body = z.infer<typeof securityLakeSourceUpdateInputSchema>; // ../contract/src/features/ocsf/security-lake.ts:133
type Response = z.infer<typeof securityLakeSourceSchema>; // ../contract/src/features/ocsf/security-lake.ts:154
```

#### `POST /api/governance/security-lake/sources/:sourceId/test` · `testSecurityLakeSource`

Test a Security Lake source's connection

Permission `ingestionSources:manage`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:179`.

Answers at `/api/governance/security-lake/sources/:sourceId/test`, `/api/v1/governance/security-lake/sources/:sourceId/test`.

```typescript
type Params = z.infer<typeof sourceParams>; // src/transport/ocsf-siem.rest.ts:33
type Body = z.infer<typeof securityLakeConnectionTestInputSchema>; // ../contract/src/features/ocsf/security-lake.ts:199
// Response: securityLakeConnectionTestSchema, ../contract/src/features/ocsf/security-lake.ts:168
interface Response {
  ok: boolean;
  waiting: number | null;
  inFlight: number | null;
  error: string | null;
}
```

#### `GET /api/governance/security-lake/sources/:sourceId` · `getSecurityLakeSource`

Read a Security Lake source

Permission `ingestionSources:manage`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:204`.

Answers at `/api/governance/security-lake/sources/:sourceId`, `/api/v1/governance/security-lake/sources/:sourceId`.

```typescript
type Params = z.infer<typeof sourceParams>; // src/transport/ocsf-siem.rest.ts:33
type Response = z.infer<typeof securityLakeSourceSchema>; // ../contract/src/features/ocsf/security-lake.ts:154
```

#### `GET /api/governance/security-lake/sources/:sourceId/health` · `getSecurityLakeSourceHealth`

Read a Security Lake source's health

Permission `ingestionSources:view`. Entitlement `enterprise` (feature `OCSF_EXPORT`). Declared at `src/transport/ocsf-siem.rest.ts:221`.

Answers at `/api/governance/security-lake/sources/:sourceId/health`, `/api/v1/governance/security-lake/sources/:sourceId/health`.

```typescript
type Params = z.infer<typeof sourceParams>; // src/transport/ocsf-siem.rest.ts:33
type Response = z.infer<typeof securityLakeSourceHealthSchema>; // ../contract/src/features/ocsf/security-lake.ts:182
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
type Output = z.infer<typeof activityMonitorSummarySchema>; // ../contract/src/features/ingestion/ingestion-source-activity.queries.ts:62

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
// Output: spendOverTimeResultSchema, ../contract/src/features/ingestion/ingestion-source-activity.queries.ts:150
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
// Output: sourceHealthMetricsSchema, ../contract/src/features/ingestion/ingestion-source-activity.queries.ts:210
interface Output {
  events24h: number;
  events7d: number;
  events30d: number;
  lastSuccessIso: string | null;
}
```

### `aiTools`

Contract `../contract/src/ai-tools.trpc.ts:60`, router `src/transport/ai-tools.trpc.ts:10`.

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
// Output: aiToolEntrySchema.array() (inline, ../contract/src/ai-tools.trpc.ts:63)

// aiTools.providerAvailability
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: aiToolProviderAvailabilitySchema, ../contract/src/ai-tool-catalog.ts:371
interface Output {
  configuredProviders: string[];
}

// aiTools.claudeCodeOtlpEndpoint
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: aiToolOtlpEndpointSchema, ../contract/src/ai-tool-catalog.ts:383
interface Output {
  endpoint: string | null;
}

// aiTools.adminList
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: aiToolEntrySchema.array() (inline, ../contract/src/ai-tools.trpc.ts:75)

// aiTools.get
// Input: entryInOrganization, ../contract/src/ai-tools.trpc.ts:19
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:125

// aiTools.create
// Input: aiToolCreateSchema, ../contract/src/ai-tools.trpc.ts:45
interface Input {
  organizationId: string;
  departmentIds?: string[];
  type: "coding_assistant" | "model_provider" | "external_tool";
  displayName: string;
  iconAsset?: string | null;
  order?: number;
  config: Record<string, unknown>;
}
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:125

// aiTools.update
// Input: aiToolUpdateSchema, ../contract/src/ai-tools.trpc.ts:58
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
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:125

// aiTools.remove
type Input = z.infer<typeof entryInOrganization>; // ../contract/src/ai-tools.trpc.ts:19
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:125

// aiTools.setEnabled
// Input: inline, ../contract/src/ai-tools.trpc.ts:94
interface Input {
  organizationId: string;
  id: string;
  enabled: boolean;
}
type Output = z.infer<typeof aiToolEntrySchema>; // ../contract/src/ai-tool-catalog.ts:125

// aiTools.importStarterPack
// Input: inline, ../contract/src/ai-tools.trpc.ts:98
interface Input {
  organizationId: string;
  slugs?: string[];
}
// Output: aiToolStarterPackImportSchema, ../contract/src/ai-tool-catalog.ts:417
interface Output {
  created: number;
  updated: number;
  skipped: number;
}

// aiTools.starterPackCatalog
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: inline, ../contract/src/ai-tools.trpc.ts:103
type Output = {
  slug: string;
  displayName: string;
  type: "coding_assistant" | "model_provider" | "external_tool";
}[];

// aiTools.providerOptions
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: inline, ../contract/src/ai-tools.trpc.ts:107
type Output = {
  providerKey: string;
  displayName: string;
  configured: boolean;
}[];

// aiTools.routingPolicyOptions
type Input = z.infer<typeof organizationScope>; // ../contract/src/ai-tools.trpc.ts:18
// Output: inline, ../contract/src/ai-tools.trpc.ts:111
type Output = {
  id: string;
  name: string;
}[];

// aiTools.reorder
// Input: inline, ../contract/src/ai-tools.trpc.ts:115
interface Input {
  organizationId: string;
  updates: {
    id: string;
    order: number;
  }[];
}
// Output: governanceWriteAcknowledgedSchema, ../contract/src/governance.responses.ts:14
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
type Output = z.infer<typeof anomalyRuleSchema>; // ../contract/src/anomaly-rule.ts:43

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
type Output = z.infer<typeof anomalyRuleSchema>; // ../contract/src/anomaly-rule.ts:43

// anomalyRules.update
type Input = z.infer<typeof updateAnomalyRuleInputSchema>; // ../contract/src/anomaly-rule.ts:83
type Output = z.infer<typeof anomalyRuleSchema>; // ../contract/src/anomaly-rule.ts:43

// anomalyRules.archive
type Input = z.infer<typeof ruleInOrganization>; // ../contract/src/anomaly-rules.trpc.ts:13
type Output = z.infer<typeof anomalyRuleSchema>; // ../contract/src/anomaly-rule.ts:43
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
type Output = z.infer<typeof departmentAssignmentsSchema>; // ../contract/src/department.ts:48

// departments.create
// Input: inline, ../contract/src/departments.trpc.ts:23
interface Input {
  organizationId: string;
  name: string;
}
// Output: departmentSchema, ../contract/src/department.ts:13
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
type Output = z.infer<typeof departmentSchema>; // ../contract/src/department.ts:13

// departments.archive
// Input: departmentInOrganization, ../contract/src/departments.trpc.ts:11
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:14

// departments.assignUser
// Input: inline, ../contract/src/departments.trpc.ts:36
interface Input {
  organizationId: string;
  userId: string;
  departmentId: string | null;
}
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:14

// departments.assignTeam
// Input: inline, ../contract/src/departments.trpc.ts:46
interface Input {
  organizationId: string;
  teamId: string;
  departmentId: string | null;
}
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:14

// departments.assignProject
// Input: inline, ../contract/src/departments.trpc.ts:56
interface Input {
  organizationId: string;
  projectId: string;
  departmentId: string | null;
}
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:14
```

### `governanceAgents`

Contract `../contract/src/governance-agents.ts:96`, router `src/transport/governance-agents.trpc.ts:9`.

| Procedure                         | Kind     | Gate                           | Input               | Output                            |
| --------------------------------- | -------- | ------------------------------ | ------------------- | --------------------------------- |
| `governanceAgents.list`           | query    | Permission `governance:view`   | `organizationScope` | inline                            |
| `governanceAgents.syncSources`    | query    | Permission `governance:view`   | `organizationScope` | inline                            |
| `governanceAgents.requestListing` | mutation | Permission `governance:manage` | `organizationScope` | `agentListingRequestResultSchema` |

```typescript
// governanceAgents.list
// Input: organizationScope, ../contract/src/governance-agents.ts:22
interface Input {
  organizationId: string;
}
// Output: governanceAgentRowSchema.array() (inline, ../contract/src/governance-agents.ts:99)

// governanceAgents.syncSources
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance-agents.ts:22
// Output: agentSyncSourceListingSchema.array() (inline, ../contract/src/governance-agents.ts:103)

// governanceAgents.requestListing
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance-agents.ts:22
// Output: agentListingRequestResultSchema, ../contract/src/governance-agents.ts:52
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

Contract `../contract/src/features/cost/governance-cost.trpc.ts:15`, router `src/transport/governance-cost.trpc.ts:13`.

| Procedure                        | Kind  | Gate                                                 | Input                                    | Output                                     |
| -------------------------------- | ----- | ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `governanceCost.summary`         | query | Permission `governanceCost:view`                     | `governanceCostWindowInputSchema`        | `governanceCostSummarySchema`              |
| `governanceCost.dailyByProvider` | query | Permission `governanceCost:view`                     | `governanceCostWindowInputSchema`        | `governanceCostProviderDayBreakdownSchema` |
| `governanceCost.spendByModel`    | query | Permission `governanceCost:view`                     | `governanceCostWindowInputSchema`        | `governanceCostModelBreakdownSchema`       |
| `governanceCost.periodRecords`   | query | Permission `governanceCost:view`                     | `governanceCostPeriodRecordsInputSchema` | `governanceCostDayRecordsSchema`           |
| `governanceCost.spenders`        | query | Permission `governanceCost:view and governance:view` | `governanceCostWindowInputSchema`        | `governanceSpenderBreakdownSchema`         |

```typescript
// governanceCost.summary
// Input: governanceCostWindowInputSchema, ../contract/src/features/cost/governance-cost.ts:36
interface Input {
  organizationId: string;
  windowDays?: number;
}
type Output = z.infer<typeof governanceCostSummarySchema>; // ../contract/src/features/cost/governance-cost.ts:283

// governanceCost.dailyByProvider
type Input = z.infer<typeof governanceCostWindowInputSchema>; // ../contract/src/features/cost/governance-cost.ts:36
// Output: governanceCostProviderDayBreakdownSchema, ../contract/src/features/cost/governance-cost.ts:84
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
type Input = z.infer<typeof governanceCostWindowInputSchema>; // ../contract/src/features/cost/governance-cost.ts:36
// Output: governanceCostModelBreakdownSchema, ../contract/src/features/cost/governance-cost.ts:106
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
// Input: governanceCostPeriodRecordsInputSchema, ../contract/src/features/cost/governance-cost.ts:51
interface Input {
  organizationId: string;
  fromDay: string;
  toDay: string;
  provider: string;
}
// Output: governanceCostDayRecordsSchema, ../contract/src/features/cost/governance-cost.ts:128
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
type Input = z.infer<typeof governanceCostWindowInputSchema>; // ../contract/src/features/cost/governance-cost.ts:36
type Output = z.infer<typeof governanceSpenderBreakdownSchema>; // ../contract/src/features/cost/governance-cost.ts:154
```

### `governanceKillSwitch`

Contract `../contract/src/features/kill-switch/agent-kill-switch.ts:582`, router `src/transport/governance-kill-switch.trpc.ts:33`.

| Procedure                                  | Kind     | Gate                                                                                | Input  | Output                    |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------- | ------ | ------------------------- |
| `governanceKillSwitch.summaries`           | query    | Permission `governance:view`; Entitlement `enterprise` (feature `AGENT_REGISTRY`)   | inline | inline                    |
| `governanceKillSwitch.pendingApprovals`    | query    | Permission `governance:view`; Entitlement `enterprise` (feature `AGENT_REGISTRY`)   | inline | inline                    |
| `governanceKillSwitch.plan`                | query    | Permission `governance:view`; Entitlement `enterprise` (feature `AGENT_REGISTRY`)   | inline | `agentStopPlanSchema`     |
| `governanceKillSwitch.setPlan`             | mutation | Permission `governance:manage`; Entitlement `enterprise` (feature `AGENT_REGISTRY`) | inline | `agentStopPlanSchema`     |
| `governanceKillSwitch.awsConnections`      | query    | Permission `governance:view`; Entitlement `enterprise` (feature `AGENT_REGISTRY`)   | inline | inline                    |
| `governanceKillSwitch.createAwsConnection` | mutation | Permission `governance:manage`; Entitlement `enterprise` (feature `AGENT_REGISTRY`) | inline | `awsConnectionViewSchema` |
| `governanceKillSwitch.deleteAwsConnection` | mutation | Permission `governance:manage`; Entitlement `enterprise` (feature `AGENT_REGISTRY`) | inline | inline                    |
| `governanceKillSwitch.requestStop`         | mutation | Permission `governance:manage`; Entitlement `enterprise` (feature `AGENT_REGISTRY`) | inline | `agentStopViewSchema`     |
| `governanceKillSwitch.approveStop`         | mutation | Permission `governance:manage`; Entitlement `enterprise` (feature `AGENT_REGISTRY`) | inline | `agentStopViewSchema`     |
| `governanceKillSwitch.denyStop`            | mutation | Permission `governance:manage`; Entitlement `enterprise` (feature `AGENT_REGISTRY`) | inline | `agentStopViewSchema`     |
| `governanceKillSwitch.restore`             | mutation | Permission `governance:manage`; Entitlement `enterprise` (feature `AGENT_REGISTRY`) | inline | `agentStopViewSchema`     |
| `governanceKillSwitch.retryStop`           | mutation | Permission `governance:manage`; Entitlement `enterprise` (feature `AGENT_REGISTRY`) | inline | `agentStopViewSchema`     |

```typescript
// governanceKillSwitch.summaries
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:584
interface Input {
  organizationId: string;
}
// Output: agentKillSwitchSummarySchema.array() (inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:585)

// governanceKillSwitch.pendingApprovals
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:588
interface Input {
  organizationId: string;
}
// Output: agentStopViewSchema.array() (inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:589)

// governanceKillSwitch.plan
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:592
interface Input {
  organizationId: string;
  agentId: string;
}
type Output = z.infer<typeof agentStopPlanSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:75

// governanceKillSwitch.setPlan
// Input: z.object({ ...agentScope, targets: setAgentStopPlanInputSchema.shape.targets, expectedVer… (inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:597)
type Output = z.infer<typeof agentStopPlanSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:75

// governanceKillSwitch.awsConnections
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:606
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:607
type Output = {
  id: string;
  name: string;
  accessKeyIdLastFour: string | null;
  roleArn: string | null;
  externalId: string | null;
  createdAt: string;
}[];

// governanceKillSwitch.createAwsConnection
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:610
interface Input {
  organizationId: string;
  connection: {
    name: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    roleArn?: string;
  };
}
// Output: awsConnectionViewSchema, ../contract/src/features/kill-switch/agent-kill-switch.ts:133
interface Output {
  id: string;
  name: string;
  accessKeyIdLastFour: string | null;
  roleArn: string | null;
  externalId: string | null;
  createdAt: string;
}

// governanceKillSwitch.deleteAwsConnection
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:614
interface Input {
  organizationId: string;
  connectionId: string;
}
// Output: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:615
interface Output {
  deleted: boolean;
}

// governanceKillSwitch.requestStop
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:619
interface Input {
  organizationId: string;
  agentId: string;
  reason: string;
  expectedTargetIds?: string[];
}
type Output = z.infer<typeof agentStopViewSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:248

// governanceKillSwitch.approveStop
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:629
interface Input {
  organizationId: string;
  stopId: string;
  note?: string;
  expectedTargetIds?: string[];
}
type Output = z.infer<typeof agentStopViewSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:248

// governanceKillSwitch.denyStop
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:638
interface Input {
  organizationId: string;
  stopId: string;
  note?: string;
}
type Output = z.infer<typeof agentStopViewSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:248

// governanceKillSwitch.restore
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:642
interface Input {
  organizationId: string;
  stopId: string;
}
type Output = z.infer<typeof agentStopViewSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:248

// governanceKillSwitch.retryStop
// Input: inline, ../contract/src/features/kill-switch/agent-kill-switch.ts:646
interface Input {
  organizationId: string;
  stopId: string;
}
type Output = z.infer<typeof agentStopViewSchema>; // ../contract/src/features/kill-switch/agent-kill-switch.ts:248
```

### `governancePeople`

Contract `../contract/src/governance-people.ts:72`, router `src/transport/governance-people.trpc.ts:9`.

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
// Output: peopleScreenPersonSchema.array() (inline, ../contract/src/governance-people.ts:75)

// governancePeople.suggestions
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance-people.ts:6
// Output: inline, ../contract/src/governance-people.ts:79
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
// Output: identityMatchRunSchema, ../contract/src/governance-people.ts:58
interface Output {
  linked: number;
  suspended: number;
  unproven: number;
}

// governancePeople.confirmSuggestion
// Input: inline, ../contract/src/governance-people.ts:86
interface Input {
  organizationId: string;
  suggestionId: string;
}
// Output: identityMatchConfirmedSchema, ../contract/src/governance-people.ts:69
interface Output {
  discoveredPersonId: string;
  userId: string;
}
```

### `governanceRegistry`

Contract `../contract/src/features/registry/agent-registry-settings.ts:43`, router `src/transport/governance-registry.trpc.ts:12`.

| Procedure                         | Kind     | Gate                                 | Input               | Output                        |
| --------------------------------- | -------- | ------------------------------------ | ------------------- | ----------------------------- |
| `governanceRegistry.settings`     | query    | Permission `governance:view`         | `organizationScope` | `agentRegistrySettingsSchema` |
| `governanceRegistry.saveSettings` | mutation | Permission `ingestionSources:manage` | inline              | `agentRegistrySettingsSchema` |

```typescript
// governanceRegistry.settings
// Input: organizationScope, ../contract/src/features/registry/agent-registry-settings.ts:41
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof agentRegistrySettingsSchema>; // ../contract/src/features/registry/agent-registry-settings.ts:29

// governanceRegistry.saveSettings
// Input: inline, ../contract/src/features/registry/agent-registry-settings.ts:49
interface Input {
  organizationId: string;
  dormant_after_days: number;
}
type Output = z.infer<typeof agentRegistrySettingsSchema>; // ../contract/src/features/registry/agent-registry-settings.ts:29
```

### `governance`

Contract `../contract/src/governance.trpc.ts:26`, router `src/transport/governance.trpc.ts:13`.

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
// Input: inline, ../contract/src/governance.trpc.ts:31
interface Input {
  organizationId: string;
  actor: string;
}
// Output: inline, ../contract/src/governance.trpc.ts:32
type Output = {
  userId: string;
  displayName: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
} | null;

// governance.resolveHome
// Input: organizationScope, ../contract/src/governance.trpc.ts:24
interface Input {
  organizationId: string;
}
// Output: personaResolutionSchema, ../contract/src/features/personal/persona-home.ts:56
interface Output {
  persona: "personal_only" | "mixed" | "project_only" | "governance_admin";
  destination: string;
  isOverride: boolean;
  governanceUiEnabled: boolean;
  intentPinned: boolean;
  firstProjectSlug: string | null;
}

// governance.setupState
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance.trpc.ts:24
// Output: governanceSetupStateSchema, ../contract/src/governance.ts:66
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
// Input: inline, ../contract/src/governance.trpc.ts:47
interface Input {
  organizationId: string;
  sinceMs?: number;
  sinceEventId?: string;
  limit?: number;
}
type Output = z.infer<typeof governanceOcsfExportPageSchema>; // ../contract/src/ocsf-export.ts:42

// governance.quarantineFillStats
// Input: inline, ../contract/src/governance.trpc.ts:59
interface Input {
  organizationId: string;
  windowSeconds?: number;
  threshold?: number;
}
// Output: quarantineFillStatsSchema, ../contract/src/features/ingestion/quarantine-fill.ts:42
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
// Input: inline, ../contract/src/governance.trpc.ts:70
interface Input {
  organizationId: string;
  targetTeamId: string;
  kind: "personal" | "team";
  workspaceLabel?: string;
}
// Output: recordWorkspaceViewResultSchema, ../contract/src/admin-workspace-view-audit.ts:50
interface Output {
  recorded: boolean;
  auditLogId: string | null;
}

// governance.personalUsage
// Input: inline, ../contract/src/governance.trpc.ts:82
interface Input {
  organizationId: string;
  windowStartMs?: number;
  windowEndMs?: number;
}
type Output = z.infer<typeof personalUsageRollupSchema>; // ../contract/src/features/personal/personal-usage.ts:101

// governance.budgetOverview
// Input: inline, ../contract/src/governance.trpc.ts:92
interface Input {
  organizationId: string;
  includeTopModels?: boolean;
}
type Output = z.infer<typeof governanceBudgetOverviewForUserSchema>; // ../contract/src/features/personal/personal-budget-overview.ts:67

// governance.cliBootstrap
type Input = z.infer<typeof organizationScope>; // ../contract/src/governance.trpc.ts:24
type Output = z.infer<typeof cliBootstrapResultSchema>; // ../contract/src/features/cli/cli-bootstrap.ts:57
```

### `ingestionKey`

Contract `../contract/src/features/ingestion/ingestion-key.trpc.ts:52`, router `src/transport/ingestion-key.trpc.ts:12`.

| Procedure              | Kind     | Gate                           | Input                         | Output                      |
| ---------------------- | -------- | ------------------------------ | ----------------------------- | --------------------------- |
| `ingestionKey.list`    | query    | Permission `organization:view` | inline                        | inline                      |
| `ingestionKey.install` | mutation | Permission `organization:view` | `ingestionKeyMintInputSchema` | `issuedIngestionKeySchema`  |
| `ingestionKey.rotate`  | mutation | Permission `organization:view` | `ingestionKeyMintInputSchema` | `rotatedIngestionKeySchema` |
| `ingestionKey.revoke`  | mutation | Permission `organization:view` | inline                        | inline                      |

```typescript
// ingestionKey.list
// Input: inline, ../contract/src/features/ingestion/ingestion-key.trpc.ts:54
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/features/ingestion/ingestion-key.trpc.ts:55
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
// Input: ingestionKeyMintInputSchema, ../contract/src/features/ingestion/ingestion-key.trpc.ts:39
interface Input {
  organizationId: string;
  sourceType: string;
  templateId?: string;
}
// Output: issuedIngestionKeySchema, ../contract/src/features/ingestion/ingestion-source-key.commands.ts:35
interface Output {
  token: string;
  apiKeyId: string;
  prefix: string;
  sourceType: string;
}

// ingestionKey.rotate
type Input = z.infer<typeof ingestionKeyMintInputSchema>; // ../contract/src/features/ingestion/ingestion-key.trpc.ts:39
// Output: rotatedIngestionKeySchema, ../contract/src/features/ingestion/ingestion-key.trpc.ts:49
interface Output {
  token: string;
  apiKeyId: string;
  prefix: string;
  sourceType: string;
  revokedCount: number;
  revokedDeviceLabels: string[];
}

// ingestionKey.revoke
// Input: inline, ../contract/src/features/ingestion/ingestion-key.trpc.ts:66
interface Input {
  organizationId: string;
  apiKeyId: string;
}
// Output: inline, ../contract/src/features/ingestion/ingestion-key.trpc.ts:67
interface Output {
  success: true;
}
```

### `ingestionSources`

Contract `../contract/src/features/ingestion/ingestion-sources.trpc.ts:106`, router `src/transport/ingestion-sources.trpc.ts:12`.

| Procedure                                           | Kind     | Gate                                                                                   | Input                              | Output                             |
| --------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- |
| `ingestionSources.list`                             | query    | Permission `ingestionSources:view`                                                     | `organizationScope`                | inline                             |
| `ingestionSources.get`                              | query    | Permission `ingestionSources:view`                                                     | `sourceInOrganization`             | `ingestionSourceDtoSchema`         |
| `ingestionSources.create`                           | mutation | Permission `ingestionSources:manage`                                                   | `ingestionSourceCreateInputSchema` | `createdIngestionSourceSchema`     |
| `ingestionSources.update`                           | mutation | Permission `ingestionSources:manage`                                                   | `ingestionSourceUpdateInputSchema` | `ingestionSourceDtoSchema`         |
| `ingestionSources.securityLakeCreate`               | mutation | Permission `ingestionSources:manage`; Entitlement `enterprise` (feature `OCSF_EXPORT`) | inline                             | `securityLakeSourceSchema`         |
| `ingestionSources.securityLakeUpdate`               | mutation | Permission `ingestionSources:manage`; Entitlement `enterprise` (feature `OCSF_EXPORT`) | inline                             | `securityLakeSourceSchema`         |
| `ingestionSources.securityLakeGet`                  | query    | Permission `ingestionSources:manage`; Entitlement `enterprise` (feature `OCSF_EXPORT`) | `sourceInOrganization`             | `securityLakeSourceSchema`         |
| `ingestionSources.securityLakeTestConnection`       | mutation | Permission `ingestionSources:manage`; Entitlement `enterprise` (feature `OCSF_EXPORT`) | inline                             | `securityLakeConnectionTestSchema` |
| `ingestionSources.securityLakeHealth`               | query    | Permission `ingestionSources:view`; Entitlement `enterprise` (feature `OCSF_EXPORT`)   | `sourceInOrganization`             | `securityLakeSourceHealthSchema`   |
| `ingestionSources.securityLakeCallersWithoutTraces` | query    | Permission `ingestionSources:view`; Entitlement `enterprise` (feature `OCSF_EXPORT`)   | `organizationScope`                | `securityLakeCallersSchema`        |
| `ingestionSources.rotateSecret`                     | mutation | Permission `ingestionSources:manage`                                                   | `sourceInOrganization`             | `ingestionSourceWithSecretSchema`  |
| `ingestionSources.archive`                          | mutation | Permission `ingestionSources:manage`                                                   | `sourceInOrganization`             | `ingestionSourceDtoSchema`         |
| `ingestionSources.validateOttl`                     | mutation | Permission `ingestionSources:manage`                                                   | inline                             | `ottlValidationResultSchema`       |
| `ingestionSources.ottlStarter`                      | query    | Permission `ingestionSources:view`                                                     | inline                             | `ottlStarterTemplateSchema`        |
| `ingestionSources.testAgentListing`                 | mutation | Permission `ingestionSources:manage`                                                   | `testAgentListingInputSchema`      | `testAgentListingResultSchema`     |
| `ingestionSources.testAgentListingForSource`        | mutation | Permission `ingestionSources:manage`                                                   | inline                             | `testAgentListingResultSchema`     |

```typescript
// ingestionSources.list
// Input: organizationScope, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:27
interface Input {
  organizationId: string;
}
// Output: ingestionSourceDtoSchema.array() (inline, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:109)

// ingestionSources.get
// Input: sourceInOrganization, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:28
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof ingestionSourceDtoSchema>; // ../contract/src/features/ingestion/ingestion-source.ts:81

// ingestionSources.create
type Input = z.infer<typeof ingestionSourceCreateInputSchema>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:45
type Output = z.infer<typeof createdIngestionSourceSchema>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:73

// ingestionSources.update
// Input: ingestionSourceUpdateInputSchema, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:62
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
type Output = z.infer<typeof ingestionSourceDtoSchema>; // ../contract/src/features/ingestion/ingestion-source.ts:81

// ingestionSources.securityLakeCreate
// Input: z.object({ ...organizationScope.shape, ...securityLakeSourceCreateInputSchema.shape }) (inline, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:124)
type Output = z.infer<typeof securityLakeSourceSchema>; // ../contract/src/features/ocsf/security-lake.ts:154

// ingestionSources.securityLakeUpdate
// Input: z.object({ ...sourceInOrganization.shape, ...securityLakeSourceUpdateInputSchema.shape }) (inline, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:129)
type Output = z.infer<typeof securityLakeSourceSchema>; // ../contract/src/features/ocsf/security-lake.ts:154

// ingestionSources.securityLakeGet
type Input = z.infer<typeof sourceInOrganization>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:28
type Output = z.infer<typeof securityLakeSourceSchema>; // ../contract/src/features/ocsf/security-lake.ts:154

// ingestionSources.securityLakeTestConnection
// Input: z.object({ ...sourceInOrganization.shape, ...securityLakeConnectionTestInputSchema.shape … (inline, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:139)
type Output = z.infer<typeof securityLakeConnectionTestSchema>; // ../contract/src/features/ocsf/security-lake.ts:168

// ingestionSources.securityLakeHealth
type Input = z.infer<typeof sourceInOrganization>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:28
type Output = z.infer<typeof securityLakeSourceHealthSchema>; // ../contract/src/features/ocsf/security-lake.ts:182

// ingestionSources.securityLakeCallersWithoutTraces
type Input = z.infer<typeof organizationScope>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:27
// Output: securityLakeCallersSchema, ../contract/src/features/ocsf/security-lake.ts:227
interface Output {
  callers: {
    principalArn: string;
    models: string[];
    regions: string[];
    lastCallMs: number;
    callCount: number;
  }[];
}

// ingestionSources.rotateSecret
type Input = z.infer<typeof sourceInOrganization>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:28
type Output = z.infer<typeof ingestionSourceWithSecretSchema>; // ../contract/src/features/ingestion/ingestion-source.ts:95

// ingestionSources.archive
type Input = z.infer<typeof sourceInOrganization>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:28
type Output = z.infer<typeof ingestionSourceDtoSchema>; // ../contract/src/features/ingestion/ingestion-source.ts:81

// ingestionSources.validateOttl
// Input: inline, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:161
interface Input {
  organizationId: string;
  statements: string[];
}
type Output = z.infer<typeof ottlValidationResultSchema>; // ../contract/src/features/ingestion/ottl.ts:45

// ingestionSources.ottlStarter
// Input: inline, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:166
interface Input {
  organizationId: string;
  sourceType: string;
}
// Output: ottlStarterTemplateSchema, ../contract/src/features/ingestion/ingestion-source.ts:112
interface Output {
  enabled: boolean;
  statements: string[];
  enabledSourceTypes: string[];
}

// ingestionSources.testAgentListing
type Input = z.infer<typeof testAgentListingInputSchema>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:86
type Output = z.infer<typeof testAgentListingResultSchema>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:103

// ingestionSources.testAgentListingForSource
// Input: inline, ../contract/src/features/ingestion/ingestion-sources.trpc.ts:174
interface Input {
  organizationId: string;
  sourceId: string;
}
type Output = z.infer<typeof testAgentListingResultSchema>; // ../contract/src/features/ingestion/ingestion-sources.trpc.ts:103
```

### `ingestionTemplates`

Contract `../contract/src/features/ingestion/ingestion-templates.trpc.ts:27`, router `src/transport/ingestion-templates.trpc.ts:15`.

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
// Input: organizationScope, ../contract/src/features/ingestion/ingestion-templates.trpc.ts:9
interface Input {
  organizationId: string;
}
// Output: ingestionTemplateSchema.array() (inline, ../contract/src/features/ingestion/ingestion-templates.trpc.ts:30)

// ingestionTemplates.adminList
type Input = z.infer<typeof organizationScope>; // ../contract/src/features/ingestion/ingestion-templates.trpc.ts:9
// Output: ingestionTemplateSchema.array() (inline, ../contract/src/features/ingestion/ingestion-templates.trpc.ts:34)

// ingestionTemplates.get
// Input: templateInOrganization, ../contract/src/features/ingestion/ingestion-templates.trpc.ts:10
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof ingestionTemplateSchema>; // ../contract/src/features/ingestion/ingestion-template.ts:26

// ingestionTemplates.create
// Input: ingestionTemplateCreateSchema, ../contract/src/features/ingestion/ingestion-templates.trpc.ts:25
interface Input {
  organizationId: string;
  sourceType: string;
  displayName: string;
  description?: string;
  iconAsset?: string;
  credentialSchema?: "otlp_token" | "static_api_key" | "agent_id" | null;
  ottlRules?: string;
}
type Output = z.infer<typeof ingestionTemplateSchema>; // ../contract/src/features/ingestion/ingestion-template.ts:26

// ingestionTemplates.updateOttlRules
// Input: inline, ../contract/src/features/ingestion/ingestion-templates.trpc.ts:45
interface Input {
  organizationId: string;
  id: string;
  ottlRules: string;
}
type Output = z.infer<typeof ingestionTemplateSchema>; // ../contract/src/features/ingestion/ingestion-template.ts:26

// ingestionTemplates.archive
type Input = z.infer<typeof templateInOrganization>; // ../contract/src/features/ingestion/ingestion-templates.trpc.ts:10
type Output = z.infer<typeof governanceWriteAcknowledgedSchema>; // ../contract/src/governance.responses.ts:14

// ingestionTemplates.cloneFromPlatform
// Input: inline, ../contract/src/features/ingestion/ingestion-templates.trpc.ts:53
interface Input {
  organizationId: string;
  sourceTemplateId: string;
}
type Output = z.infer<typeof ingestionTemplateSchema>; // ../contract/src/features/ingestion/ingestion-template.ts:26
```

### `personalSessions`

Contract `../contract/src/features/personal/personal-sessions.trpc.ts:12`, router `src/transport/personal-sessions.trpc.ts:17`.

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
// Input: organizationScope, ../contract/src/features/personal/personal-sessions.trpc.ts:9
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/features/personal/personal-sessions.trpc.ts:15
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
// Input: inline, ../contract/src/features/personal/personal-sessions.trpc.ts:19
interface Input {
  organizationId: string;
  sessionStartedAtMs: number;
}
// Output: cliSessionRevocationSchema, ../contract/src/features/cli/cli-sessions.ts:72
interface Output {
  ok: boolean;
  revokedTokens: number;
  revokedKeys: number;
}

// personalSessions.revokeAll
type Input = z.infer<typeof organizationScope>; // ../contract/src/features/personal/personal-sessions.trpc.ts:9
type Output = z.infer<typeof cliSessionRevocationSchema>; // ../contract/src/features/cli/cli-sessions.ts:72

// personalSessions.listWebSessions
// Input: inline, ../contract/src/features/personal/personal-sessions.trpc.ts:28
type Input = Record<string, unknown>;
// Output: browserSessionInventoryEntrySchema.array() (inline, ../contract/src/features/personal/personal-sessions.trpc.ts:29)

// personalSessions.revokeWebSession
// Input: inline, ../contract/src/features/personal/personal-sessions.trpc.ts:32
interface Input {
  sessionId: string;
}
// Output: webSessionsEnded, ../contract/src/features/personal/personal-sessions.trpc.ts:10
interface Output {
  ended: number;
}

// personalSessions.revokeWebSessionsForIdentifier
// Input: inline, ../contract/src/features/personal/personal-sessions.trpc.ts:36
interface Input {
  identifierId: string;
}
type Output = z.infer<typeof webSessionsEnded>; // ../contract/src/features/personal/personal-sessions.trpc.ts:10
```

### `sessionPolicy`

Contract `../contract/src/session-policy.ts:26`, router `src/transport/session-policy.trpc.ts:9`.

| Procedure                      | Kind     | Gate                             | Input  | Output                            |
| ------------------------------ | -------- | -------------------------------- | ------ | --------------------------------- |
| `sessionPolicy.get`            | query    | Permission `organization:view`   | inline | `organizationSessionPolicySchema` |
| `sessionPolicy.setMaxDuration` | mutation | Permission `organization:manage` | inline | `sessionCeilingAppliedSchema`     |

```typescript
// sessionPolicy.get
// Input: inline, ../contract/src/session-policy.ts:28
interface Input {
  organizationId: string;
}
// Output: organizationSessionPolicySchema, ../contract/src/session-policy.ts:13
interface Output {
  maxSessionDurationDays: number;
}

// sessionPolicy.setMaxDuration
// Input: inline, ../contract/src/session-policy.ts:33
interface Input {
  organizationId: string;
  maxSessionDurationDays: number;
}
// Output: sessionCeilingAppliedSchema, ../contract/src/session-policy.ts:23
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

Declared at `src/eventing/governance-activity-monitor.pipeline.ts:164`.

| Kind            | Name                                           | Handles                                                                                                                            | Declared at                                                |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| process manager | `spendSpikeEvaluation`                         | every 5 min (`SPEND_SPIKE_EVALUATION_INTERVAL_MS = 5 * 60 * 1000`); intents `pass` (outbox)                                        | `src/eventing/governance-activity-monitor.pipeline.ts:179` |
| process manager | `anomalyAlertDelivery`                         | every 1 d (`ANOMALY_ALERT_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `pruneDelivered`, `requestDelivery` (outbox) | `src/eventing/governance-activity-monitor.pipeline.ts:196` |
| process manager | `governanceTraceFacts`                         | every 1 min (`GOVERNANCE_TRACE_FACTS_INTERVAL_MS = 60 * 1000`); intents `pass` (outbox)                                            | `src/eventing/governance-activity-monitor.pipeline.ts:213` |
| process manager | `aggregateProjectReconcile`                    | every 1 d (`AGGREGATE_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `sweep`, `reconcile` (outbox)                             | `src/eventing/governance-activity-monitor.pipeline.ts:325` |
| peer subscriber | `seedDefaultAiToolCatalog`                     | `lw.organization.created` from [organization](../../../../modules/organization/README.md)                                          | `src/eventing/governance-activity-monitor.pipeline.ts:169` |
| peer subscriber | `assignScimCostCenterDepartment`               | `lw.scim.cost_center_changed` from [scim](../../scim/README.md)                                                                    | `src/eventing/governance-activity-monitor.pipeline.ts:174` |
| peer subscriber | `reconcileAggregatesOnProjectCreated`          | `lw.project.created` from [project](../../../../modules/project/README.md)                                                         | `src/eventing/governance-activity-monitor.pipeline.ts:236` |
| peer subscriber | `reconcileAggregatesOnProjectArchived`         | `lw.project.archived` from [project](../../../../modules/project/README.md)                                                        | `src/eventing/governance-activity-monitor.pipeline.ts:245` |
| peer subscriber | `reconcileAggregatesOnDepartmentAssigned`      | `lw.project.department_assigned` from [project](../../../../modules/project/README.md)                                             | `src/eventing/governance-activity-monitor.pipeline.ts:254` |
| peer subscriber | `reconcileAggregatesOnProjectRevived`          | `lw.project.revived` from [project](../../../../modules/project/README.md)                                                         | `src/eventing/governance-activity-monitor.pipeline.ts:263` |
| peer subscriber | `reconcileAggregateOnRuleChanged`              | `lw.project.aggregate_rule_changed` from [project](../../../../modules/project/README.md)                                          | `src/eventing/governance-activity-monitor.pipeline.ts:272` |
| peer subscriber | `reconcileAggregatesOnMemberRemoved`           | `lw.organization.member_removed` from [organization](../../../../modules/organization/README.md)                                   | `src/eventing/governance-activity-monitor.pipeline.ts:281` |
| peer subscriber | `reconcileAggregatesOnMemberDepartmentChanged` | `lw.organization.member_department_changed` from [organization](../../../../modules/organization/README.md)                        | `src/eventing/governance-activity-monitor.pipeline.ts:290` |
| peer subscriber | `reconcileAggregatesOnMemberDisabled`          | `lw.organization.member_disabled` from [organization](../../../../modules/organization/README.md)                                  | `src/eventing/governance-activity-monitor.pipeline.ts:300` |
| peer subscriber | `reconcileAggregatesOnMemberEnabled`           | `lw.organization.member_enabled` from [organization](../../../../modules/organization/README.md)                                   | `src/eventing/governance-activity-monitor.pipeline.ts:310` |
| peer subscriber | `auditAggregateRead`                           | `lw.authz.aggregate_read` from [authz](../../../../modules/authz/README.md)                                                        | `src/eventing/governance-activity-monitor.pipeline.ts:320` |
| lane aliases    | `≈ MAIN_TRACE_GOVERNANCE_LANE_TOMBSTONES`      | –                                                                                                                                  | `src/eventing/governance-activity-monitor.pipeline.ts:345` |

### Pipeline `ingestion_pull_reconcile` (aggregate `global`)

Declared at `src/eventing/ingestion-pull-reconcile.pipeline.ts:37`.

| Kind            | Name                     | Handles                                                                                     | Declared at                                            |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| process manager | `ingestionPullReconcile` | every 1 min (`INGESTION_PULL_RECONCILE_CHECK_MS = 60 * 1000`); intents `reconcile` (outbox) | `src/eventing/ingestion-pull-reconcile.pipeline.ts:42` |

### Pipeline `ingestion_pull_processing` (aggregate `ingestion_pull`)

Declared at `src/eventing/ingestion-pull.pipeline.ts:105`. Events: `ingestionPullConfiguredEventSchema`, `ingestionPullDisabledEventSchema`, `ingestionPullRunCompletedEventSchema`, `ingestionPullRunFailedEventSchema`, `ingestionPullAgentsListingRequestedEventSchema`, `ingestionPullAgentsListedEventSchema`, `ingestionPullAgentsListingRefusedEventSchema`, `ingestionPullPeopleListingRequestedEventSchema`, `ingestionPullPeopleListedEventSchema`, `ingestionPullPeopleListingRefusedEventSchema`.

| Kind                | Name                                                                             | Handles                                           | Declared at                                   |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| command             | `configure`                                                                      | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:126` |
| command             | `disable`                                                                        | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:127` |
| command             | `recordRunCompleted`                                                             | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:128` |
| command             | `recordRunFailed`                                                                | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:129` |
| command             | `requestAgentsListing`                                                           | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:130` |
| command             | `recordAgentsListed`                                                             | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:131` |
| command             | `recordAgentsListingRefused`                                                     | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:132` |
| command             | `requestPeopleListing`                                                           | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:133` |
| command             | `recordPeopleListed`                                                             | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:134` |
| command             | `recordPeopleListingRefused`                                                     | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:135` |
| process manager     | `ingestionPull`                                                                  | ≈ applier `this.options.process.processManager()` | `src/eventing/ingestion-pull.pipeline.ts:138` |
| Postgres projection | `≈ IngestionPullRunStatusEventingProjection.create(this.options.runStatusStore)` | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:123` |
| retention           | `≈ this.options.retention`                                                       | –                                                 | `src/eventing/ingestion-pull.pipeline.ts:136` |

### Pipeline `governance_ingestion_source` (aggregate `governance_ingestion_source`)

Declared at `src/eventing/ingestion-source-lifecycle.pipeline.ts:128`. Events: `ingestionSourceCreatedEventSchema`, `ingestionSourceWentLiveEventSchema`.

| Kind    | Name                            | Handles | Declared at                                               |
| ------- | ------------------------------- | ------- | --------------------------------------------------------- |
| command | `recordIngestionSourceCreated`  | –       | `src/eventing/ingestion-source-lifecycle.pipeline.ts:133` |
| command | `recordIngestionSourceWentLive` | –       | `src/eventing/ingestion-source-lifecycle.pipeline.ts:134` |

### Pipeline `pulled_usage_processing` (aggregate `pulled_usage`)

Declared at `src/eventing/pulled-usage.pipeline.ts:167`. Events: `pulledUsageObservedEventSchema`, `pulledUsageRetractedEventSchema`, `pulledUsagePricedEventSchema`.

| Kind                       | Name                      | Handles                                           | Declared at                                 |
| -------------------------- | ------------------------- | ------------------------------------------------- | ------------------------------------------- |
| command                    | `recordPulledUsage`       | –                                                 | `src/eventing/pulled-usage.pipeline.ts:178` |
| command                    | `retractPulledUsage`      | –                                                 | `src/eventing/pulled-usage.pipeline.ts:179` |
| command                    | `recordPulledUsagePriced` | –                                                 | `src/eventing/pulled-usage.pipeline.ts:180` |
| process manager            | `pulledUsageLedger`       | ≈ applier `this.ledger.processManager()`          | `src/eventing/pulled-usage.pipeline.ts:189` |
| process manager            | `costRollupWatch`         | ≈ applier `this.costRollupWatch.processManager()` | `src/eventing/pulled-usage.pipeline.ts:193` |
| retention                  | `≈ this.retention`        | –                                                 | `src/eventing/pulled-usage.pipeline.ts:181` |
| ClickHouse fold projection | `≈ this.costRollup`       | –                                                 | `src/eventing/pulled-usage.pipeline.ts:183` |
| ClickHouse map projection  | `≈ this.costCharges`      | –                                                 | `src/eventing/pulled-usage.pipeline.ts:186` |

### Pipeline `governance_agent_stop` (aggregate `agent_stop`)

Declared at `src/features/kill-switch/eventing/agent-stop.pipeline.ts:97`. Events: `agentStopRequestedEventSchema`, `agentStopApprovedEventSchema`, `agentStopDeniedEventSchema`, `agentStopTargetAppliedEventSchema`, `agentStopTargetFailedEventSchema`, `agentStopRestoreRequestedEventSchema`, `agentStopTargetRevertedEventSchema`, `agentStopTargetRevertFailedEventSchema`, `agentStopRetryRequestedEventSchema`, `agentStopTargetsDroppedEventSchema`.

| Kind                | Name                           | Handles                                                                                                               | Declared at                                                    |
| ------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| command             | `request`                      | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:114` |
| command             | `approve`                      | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:115` |
| command             | `deny`                         | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:116` |
| command             | `recordTargetApplied`          | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:117` |
| command             | `recordTargetFailed`           | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:118` |
| command             | `requestRestore`               | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:119` |
| command             | `recordTargetReverted`         | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:120` |
| command             | `recordTargetRevertFailed`     | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:121` |
| command             | `retry`                        | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:122` |
| command             | `dropTargets`                  | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:123` |
| process manager     | `agentStop`                    | intents `announce`, `revertTarget`, `applyTarget` (outbox)                                                            | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:124` |
| process manager     | `killSwitchAudit`              | every 1 d (`KILL_SWITCH_AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `pruneAudit`, `recordAudit` (outbox) | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:128` |
| Postgres projection | `≈ agentStopProjection(store)` | –                                                                                                                     | `src/features/kill-switch/eventing/agent-stop.pipeline.ts:113` |

### Pipeline `governance_ocsf_push` (aggregate `global`)

Declared at `src/features/ocsf/eventing/ocsf-push.pipeline.ts:40`.

| Kind            | Name           | Handles                                                                                                               | Declared at                                           |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| process manager | `ocsfSiemPush` | every 1 d (`OCSF_PUSH_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `pruneDelivered`, `requestDelivery` (outbox) | `src/features/ocsf/eventing/ocsf-push.pipeline.ts:46` |

### Pipeline `governance_agent_registry` (aggregate `global`)

Declared at `src/features/registry/eventing/agent-registry.pipeline.ts:92`.

| Kind            | Name                                    | Handles                                                                                                                                                   | Declared at                                                     |
| --------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| process manager | `agentRegistryDelivery`                 | every 1 d (`AGENT_REGISTRY_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `pruneDelivered`, `requestShadowAlert`, `requestDelivery` (outbox) | `src/features/registry/eventing/agent-registry.pipeline.ts:110` |
| process manager | `agentRegistryTraffic`                  | every 15 min (`AGENT_REGISTRY_TRAFFIC_INTERVAL_MS = 15 * 60 * 1000`); intents `pass` (outbox)                                                             | `src/features/registry/eventing/agent-registry.pipeline.ts:130` |
| peer subscriber | `reconcileAgentRegistryOnAgentChanged`  | `lw.agent.changed` from [agent](../../../../modules/agent/README.md)                                                                                      | `src/features/registry/eventing/agent-registry.pipeline.ts:98`  |
| peer subscriber | `reconcileAgentRegistryOnAgentArchived` | `lw.agent.archived` from [agent](../../../../modules/agent/README.md)                                                                                     | `src/features/registry/eventing/agent-registry.pipeline.ts:104` |

## Configuration

| Kind   | Leaf                              | Environment variable                  | Declared at                               |
| ------ | --------------------------------- | ------------------------------------- | ----------------------------------------- |
| secret | `–`                               | `GOVERNANCE_ERASURE_PSEUDONYM_SECRET` | `src/app/governance.app.ts:611`           |
| config | `gatewayPublicUrl`                | `LW_GATEWAY_PUBLIC_URL`               | `../contract/src/governance.config.ts:41` |
| config | `gatewayInternalUrl`              | `LW_GATEWAY_INTERNAL_URL`             | `../contract/src/governance.config.ts:42` |
| config | `gatewayLegacyUrl`                | `LW_GATEWAY_BASE_URL`                 | `../contract/src/governance.config.ts:43` |
| config | `blockLocalHttpCalls`             | `BLOCK_LOCAL_HTTP_CALLS`              | `../contract/src/governance.config.ts:45` |
| config | `allowedProxyHosts`               | `ALLOWED_PROXY_HOSTS`                 | `../contract/src/governance.config.ts:46` |
| config | `openAiAdminApiBase`              | `OPENAI_ADMIN_API_BASE`               | `../contract/src/governance.config.ts:48` |
| config | `anthropicAdminApiBase`           | `ANTHROPIC_ADMIN_API_BASE`            | `../contract/src/governance.config.ts:49` |
| config | `microsoftLoginBase`              | `MICROSOFT_LOGIN_BASE`                | `../contract/src/governance.config.ts:50` |
| config | `microsoftGraphApiBase`           | `MICROSOFT_GRAPH_API_BASE`            | `../contract/src/governance.config.ts:51` |
| config | `databricksWorkspaceBase`         | `DATABRICKS_WORKSPACE_BASE`           | `../contract/src/governance.config.ts:53` |
| config | `dataverseEnvironmentBase`        | `DATAVERSE_ENVIRONMENT_BASE`          | `../contract/src/governance.config.ts:55` |
| config | `bedrockAgentEndpoint`            | `BEDROCK_AGENT_ENDPOINT`              | `../contract/src/governance.config.ts:57` |
| config | `bedrockAgentCoreControlEndpoint` | `BEDROCK_AGENTCORE_CONTROL_ENDPOINT`  | `../contract/src/governance.config.ts:59` |
| config | `googleOauthTokenBase`            | `GOOGLE_OAUTH_TOKEN_BASE`             | `../contract/src/governance.config.ts:61` |
| config | `vertexAiApiBase`                 | `VERTEX_AI_API_BASE`                  | `../contract/src/governance.config.ts:63` |
| config | `isSaas`                          | `IS_SAAS`                             | `../contract/src/governance.config.ts:65` |
| config | `publicBaseUrl`                   | `BASE_HOST`                           | `../contract/src/governance.config.ts:67` |
| config | `ingestRateLimitDisabled`         | `LW_INGEST_RATE_LIMIT_DISABLED`       | `../contract/src/governance.config.ts:69` |

<!-- readme:generated:end -->
