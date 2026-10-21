# @langwatch/ops-process

The server half of [ops](../README.md). Platform administration for every deployment: admin operations, impersonation, blob storage inspection and the operator views over queues and the scheduler.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("ops").withRepositories(opsRepositories).withChannels(opsChannels).withApi(OpsModule).withTransports(adminRest, opsBugReportRest, opsClickHouseExplainRest, opsTrpcTransport, opsUpgradeTrpcTransport, opsBugReportTrpcTransport, checkupTrpcTransport, checkupRest).provideMiddlewareBindings(…).provideMiddlewareContext(…).withEventing(usageReportEventing).withEventing(anomalyDetectionEventing).withEventing(storageStatsEventing).withEventing(groupQueueReaperEventing).withEventing(upgradeAlertsEventing).withEventing(projectionReplayEventing).withEventing(systemMigrationsEventing).withEventing(platformOperatorSeedEventing).withTasks(…).withMigrations(…).withIdIndexes(…, …)`, `src/ops.module.ts:41`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`OpsApi`)

Peers call these through the token, declared at `../contract/src/ops.api.ts:430`; nothing else in this package is public.

#### `startAdminImpersonation`

```typescript
startAdminImpersonation(input: StartAdminImpersonationInput): Promise<AdminImpersonationStarted>;
```

#### `stopAdminImpersonation`

```typescript
stopAdminImpersonation(input: StopAdminImpersonationInput): Promise<AdminImpersonationStopped>;
```

#### `runAdminOperation`

```typescript
runAdminOperation(input: RunAdminOperationInput): Promise<AdminOperationResult>;
```

#### `startImpersonation`

```typescript
startImpersonation(input: StartImpersonationInput): Promise<void>;
```

#### `stopImpersonation`

```typescript
stopImpersonation(input: StopImpersonationInput): Promise<void>;
```

#### `listBlobQueues`

```typescript
listBlobQueues(): Promise<string[]>;
```

#### `getBlobStoreStats`

```typescript
getBlobStoreStats(): Promise<OpsBlobStoreStats>;
```

#### `listBlobs`

```typescript
listBlobs(input: ListBlobsInput): Promise<OpsBlobPage>;
```

#### `findBlob`

```typescript
findBlob(input: GetBlobInput): Promise<OpsBlobSummary | null>;
```

#### `runBlobCleanup`

A real sweep destroys blobs, so it asks the operator's confirmation; a dry run does not.

```typescript
runBlobCleanup(input: RunBlobCleanupCommand): Promise<BlobSweepReport>;
```

#### `deleteBlob`

```typescript
deleteBlob(input: DeleteBlobInput): Promise<DeleteBlobResult>;
```

#### `listAnomalies`

```typescript
listAnomalies(): Promise<Anomaly[]>;
```

#### `dismissAnomaly`

```typescript
dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean>;
```

#### `listScheduledJobs`

```typescript
listScheduledJobs(input: ListScheduledJobsInput): Promise<OpsScheduledJob[]>;
```

#### `listPausedSchedules`

```typescript
listPausedSchedules(input: ListPausedSchedulesInput): Promise<ListPausedSchedulesResult>;
```

#### `listSchedulerActions`

```typescript
listSchedulerActions(input: ListSchedulerActionsInput): Promise<SchedulerAuditEntryView[]>;
```

#### `listInsightSchedules`

Every person's daily insights schedule, across projects: the ones that are on first.

```typescript
listInsightSchedules(input: ListInsightSchedulesInput): Promise<OpsInsightSchedule[]>;
```

#### `setScheduleActive`

```typescript
setScheduleActive(input: SetScheduleActiveInput): Promise<OpsScheduledJob>;
```

#### `clearStuckScheduleSlot`

```typescript
clearStuckScheduleSlot(input: ScheduleControlInput): Promise<OpsScheduledJob>;
```

#### `runScheduleNow`

```typescript
runScheduleNow(input: ScheduleControlInput): Promise<OpsScheduledJob>;
```

#### `listQueues`

```typescript
listQueues(): Promise<QueueSummaryInfo[]>;
```

#### `listQueueGroups`

```typescript
listQueueGroups(input: ListQueueGroupsInput): Promise<OpsQueueGroupsPage>;
```

#### `findQueueGroup`

```typescript
findQueueGroup(input: FindQueueGroupInput): Promise<GroupInfo | null>;
```

#### `listQueueGroupJobs`

```typescript
listQueueGroupJobs(input: ListQueueGroupJobsInput): Promise<OpsQueueJobsPage>;
```

#### `getBlockedQueueSummary`

```typescript
getBlockedQueueSummary(): Promise<OpsBlockedSummary>;
```

#### `listParkedQueueGroups`

```typescript
listParkedQueueGroups(input: ListParkedQueueGroupsInput): Promise<OpsParkedGroupsPage>;
```

#### `listAllQueueDlqGroups`

```typescript
listAllQueueDlqGroups(): Promise<OpsQueueDlqGroupWithQueue[]>;
```

#### `unblockQueueGroup`

```typescript
unblockQueueGroup(input: UnblockQueueGroupInput): Promise<UnblockQueueGroupResult>;
```

#### `unblockAllQueueGroups`

```typescript
unblockAllQueueGroups(input: UnblockAllQueueGroupsInput): Promise<UnblockAllQueueGroupsResult>;
```

#### `reapStrandedQueueGroups`

```typescript
reapStrandedQueueGroups(input: ReapStrandedQueueGroupsInput): Promise<OpsQueueReapedStrandedGroups>;
```

#### `drainQueueGroup`

```typescript
drainQueueGroup(input: DrainQueueGroupInput): Promise<DrainQueueGroupResult>;
```

#### `pauseQueuePipeline`

```typescript
pauseQueuePipeline(input: PauseQueuePipelineInput): Promise<void>;
```

#### `unpauseQueuePipeline`

```typescript
unpauseQueuePipeline(input: UnpauseQueuePipelineInput): Promise<void>;
```

#### `retryBlockedQueueJob`

```typescript
retryBlockedQueueJob(input: RetryBlockedQueueJobInput): Promise<RetryBlockedQueueJobResult>;
```

#### `listPausedQueueKeys`

```typescript
listPausedQueueKeys(input: ListPausedQueueKeysInput): Promise<string[]>;
```

#### `pauseQueueTenant`

```typescript
pauseQueueTenant(input: PauseQueueTenantInput): Promise<void>;
```

#### `unpauseQueueTenant`

```typescript
unpauseQueueTenant(input: UnpauseQueueTenantInput): Promise<void>;
```

#### `listPausedQueueTenants`

```typescript
listPausedQueueTenants(input: ListPausedQueueTenantsInput): Promise<string[]>;
```

#### `drainQueueTenant`

```typescript
drainQueueTenant(input: DrainQueueTenantInput): Promise<DrainQueueTenantResult>;
```

#### `moveQueueGroupToDlq`

```typescript
moveQueueGroupToDlq(input: MoveQueueGroupToDlqInput): Promise<MoveQueueGroupToDlqResult>;
```

#### `moveAllBlockedQueueGroupsToDlq`

```typescript
moveAllBlockedQueueGroupsToDlq(input: MoveAllBlockedQueueGroupsToDlqInput): Promise<MoveAllBlockedQueueGroupsToDlqResult>;
```

#### `replayQueueGroupFromDlq`

```typescript
replayQueueGroupFromDlq(input: ReplayQueueGroupFromDlqInput): Promise<ReplayQueueGroupFromDlqResult>;
```

#### `replayAllQueueGroupsFromDlq`

```typescript
replayAllQueueGroupsFromDlq(input: ReplayAllQueueGroupsFromDlqInput): Promise<ReplayAllQueueGroupsFromDlqResult>;
```

#### `redriveQueueDlqGroups`

```typescript
redriveQueueDlqGroups(input: RedriveQueueDlqGroupsInput): Promise<RedriveQueueDlqGroupsResult>;
```

#### `discardQueueDlqGroups`

```typescript
discardQueueDlqGroups(input: DiscardQueueDlqGroupsInput): Promise<DiscardQueueDlqGroupsResult>;
```

#### `canaryRedriveQueueDlq`

```typescript
canaryRedriveQueueDlq(input: CanaryRedriveQueueDlqInput): Promise<CanaryRedriveQueueDlqResult>;
```

#### `canaryUnblockQueueGroups`

```typescript
canaryUnblockQueueGroups(input: CanaryUnblockQueueGroupsInput): Promise<CanaryUnblockQueueGroupsResult>;
```

#### `listQueueDlqGroups`

```typescript
listQueueDlqGroups(input: ListQueueDlqGroupsInput): Promise<OpsQueueDlqGroup[]>;
```

#### `getQueueDrainPreview`

```typescript
getQueueDrainPreview(input: GetQueueDrainPreviewInput): Promise<OpsQueueDrainPreview>;
```

#### `discoverQueueNames`

```typescript
discoverQueueNames(): Promise<string[]>;
```

#### `scanQueues`

```typescript
scanQueues(input: ScanQueuesInput): Promise<QueueInfo[]>;
```

#### `reconcileQueuePending`

```typescript
reconcileQueuePending(input: ReconcileQueuePendingInput): Promise<OpsQueueReconcileOutcome>;
```

#### `readQueuePendingDrift`

```typescript
readQueuePendingDrift(input: ReadQueuePendingDriftInput): Promise<number>;
```

#### `listParkedQueueTenants`

```typescript
listParkedQueueTenants(input: ListParkedQueueTenantsInput): Promise<OpsParkedTenantsPage>;
```

#### `isAdmin`

Whether this identity holds `ops:view` at the platform: the platform-operator grant.

```typescript
isAdmin(identity: AdminIdentity): Promise<boolean>;
```

#### `assertDestructiveOperator`

```typescript
assertDestructiveOperator(operator: OpsOperator | null, confirmation: string | undefined): void;
```

#### `operatorScope`

The caller's operator reach. `{ kind: "none" }` is an answer rather than a refusal, so the global menu can poll it on every page load.

```typescript
operatorScope(operator: OpsOperator | null): Promise<OpsScope>;
```

#### `admitOperator`

Refuses anyone who does not hold the permission at the platform tier.

```typescript
admitOperator(operator: OpsOperator | null, permission: OpsOperatorPermission): Promise<void>;
```

#### `admitCloudAdmin`

The staff list, refused as not-found so a probe learns nothing about the surface, and only where ops's cloud-ops capability is on (§3.5).

```typescript
admitCloudAdmin(operator: OpsOperator | null): Promise<OpsOperator>;
```

#### `offersCloudOps`

Whether Cloud admin is on here: the one answer the browser's public config projects.

```typescript
offersCloudOps(): boolean;
```

#### `explainClickHouseQuery`

One operator EXPLAIN, guardrails and fail-closed rule included.

```typescript
explainClickHouseQuery(input: OpsExplainRequest): Promise<OpsExplainAnswer>;
```

#### `explainClickHouseRequest`

One EXPLAIN as the operator door received it, answered in the bodies the tool parses.

```typescript
explainClickHouseRequest(input: { request: OpsExplainRequest }): Promise<OpsDoorAnswer>;
```

#### `listPipelineRegistrations`

```typescript
listPipelineRegistrations(): OpsPipelineRegistrations;
```

#### `getEventLogSearchWindow`

```typescript
getEventLogSearchWindow(): OpsEventLogSearchWindow;
```

#### `findGrafanaLinkConfig`

Null when no Grafana is configured: callers render no link, not a dead one.

```typescript
findGrafanaLinkConfig(): OpsGrafanaLinkConfig;
```

#### `findProductAnalyticsTargets`

This deployment's product-analytics target; empty where it configured none.

```typescript
findProductAnalyticsTargets(): ProductAnalyticsTarget[];
```

#### `listSystemMigrations`

```typescript
listSystemMigrations(): Promise<OpsMigrationOverview[]>;
```

#### `listUpgradeTenants`

Tenant rows across the tenant steps, newest movement first; `cursor` pages them.

```typescript
listUpgradeTenants(input: OpsUpgradeListTenantsInput): Promise<OpsUpgradeTenantPage>;
```

#### `listMigrationEnrollments`

```typescript
listMigrationEnrollments(input: { requestedBy: string }): Promise<OpsMigrationEnrollmentListing>;
```

#### `searchMigrationOrganizations`

```typescript
searchMigrationOrganizations(input: { query: string }): Promise<OpsMigrationOrganizationMatch[]>;
```

#### `enrollMigrationTenant`

```typescript
enrollMigrationTenant(input: { organizationId: string; migrationName: string; operator: OpsOperator | null; confirm?: string | undefined; }): Promise<void>;
```

#### `enrollMigrationCohort`

```typescript
enrollMigrationCohort(input: { migrationName: string; sampleSize: number; includeEnterprise: boolean; includePrivateDataplane: boolean; operator: OpsOperator | null; confirm?: string | undefined; }): Promise<OpsMigrationCohortResult>;
```

#### `withdrawMigrationTenant`

```typescript
withdrawMigrationTenant(input: { organizationId: string; migrationName: string; actorUserId: string; }): Promise<void>;
```

#### `runSystemMigrationForOrganization`

```typescript
runSystemMigrationForOrganization(input: { organizationId: string; migrationName: string; operator: OpsOperator | null; confirm?: string | undefined; }): Promise<OpsMigrationTargetedRunResult>;
```

#### `runSystemMigrationPass`

Asks a worker for one pass now; resolves once the request is recorded, not the pass.

```typescript
runSystemMigrationPass(input: { operator: OpsOperator | null }): Promise<void>;
```

#### `assertSystemMigrationLegacyWritersDrained`

```typescript
assertSystemMigrationLegacyWritersDrained(input: { migrationName: string; tenantId: string; minimumWriterGeneration: string; operator: OpsOperator | null; confirm?: string | undefined; }): Promise<void>;
```

#### `rollBackSystemMigrationTenant`

```typescript
rollBackSystemMigrationTenant(input: { migrationName: string; tenantId: string; operator: OpsOperator | null; confirm?: string | undefined; }): Promise<void>;
```

#### `listBugReports`

One page of the support inbox, audited before it is answered: reports carry transcripts and contact addresses, so who opened it is worth keeping. Search TEXT never reaches the audit row - it can be an email.

```typescript
listBugReports(input: ListBugReportsInput & { actorUserId: string }): Promise<BugReportListing>;
```

#### `getBugReport`

One report in full, audited before it is answered.

```typescript
getBugReport(input: { id: string; actorUserId: string }): Promise<BugReport>;
```

#### `submitBugReport`

File one report from a customer's coding agent. Unauthenticated on purpose: the reporter may be struggling because setup failed, so a report must never require a working login.

```typescript
submitBugReport(input: { report: SubmitBugReport; callerKey: string; /** The project the intake door verified the reporter's key for; null files unlinked. */ linkedProjectId?: string | null; }): Promise<{ id: string }>;
```

#### `receiveBugReport`

One report as the intake door received it, answered in the bodies released builds read.

```typescript
receiveBugReport(input: { report: SubmitBugReport; forwardedFor: string | null; linkedProjectId: string | null; }): Promise<OpsDoorAnswer>;
```

#### `findDashboardData`

```typescript
findDashboardData(): DashboardData | null;
```

#### `badgeCounts`

```typescript
badgeCounts(): OpsApiGetBadgeCountsOutput;
```

#### `streamDashboard`

```typescript
streamDashboard(input: StreamDashboardInput): AsyncIterable<DashboardData>;
```

#### `getQueueGroup`

```typescript
getQueueGroup(input: { queueName: string; groupId: string }): Promise<GroupInfo>;
```

#### `computeProjectionState`

```typescript
computeProjectionState(input: { aggregateId: string; tenantId: string; projectionName: string; eventIndex: number; }): Promise<ProjectionStateAtEvent>;
```

#### `searchProjects`

```typescript
searchProjects(input: { query: string; organizationId?: string; limit?: number; }): Promise<SearchProjectsResult[]>;
```

#### `getSignUpHealth`

The orphaned-organization rate for a window, derived from stored rows (D12).

```typescript
getSignUpHealth(input: OpsSignUpHealthInput): Promise<SignUpHealth>;
```

#### `listPlatformOperators`

Every live platform operator, named, oldest first.

```typescript
listPlatformOperators(): Promise<OpsPlatformOperator[]>;
```

#### `grantPlatformOperator`

Grants the role to the account an address belongs to, by a signed-in operator.

```typescript
grantPlatformOperator(input: { email: string; operator: OpsOperator | null; }): Promise<OpsPlatformOperator>;
```

#### `revokePlatformOperator`

Revokes one holder; authz refuses the last holder.

```typescript
revokePlatformOperator(input: { grantId: string; operator: OpsOperator | null }): Promise<void>;
```

#### `featureFlagCatalogue`

```typescript
featureFlagCatalogue(): Promise<OperatorFeatureFlagCatalogue>;
```

#### `setFeatureFlagEnabled`

```typescript
setFeatureFlagEnabled(input: { key: string; enabled: boolean; lastEditedBy: string | null; }): Promise<void>;
```

#### `setFeatureFlagRules`

```typescript
setFeatureFlagRules(input: { key: string; rules: FeatureFlagRules; lastEditedBy: string | null; }): Promise<void>;
```

#### `clearFeatureFlag`

```typescript
clearFeatureFlag(input: { key: string; lastEditedBy: string | null }): Promise<void>;
```

#### `discoverAggregates`

```typescript
discoverAggregates(input: DiscoverAggregatesInput): Promise<AggregateDiscovery>;
```

#### `searchAggregates`

The event-log search. `sinceMs` is optional because the explorer's own default lookback is the module's rule, not the door's: two doors asking the same question must not disagree about how far back it reaches.

```typescript
searchAggregates(input: { query: string; tenantIds: string[]; sinceMs?: number | undefined; }): Promise<AggregateSearchResult[]>;
```

#### `getAggregateEvents`

```typescript
getAggregateEvents(input: GetAggregateEventsInput): Promise<AggregateEventView[]>;
```

#### `getForAggregate`

```typescript
getForAggregate(input: GetForAggregateInput): Promise<AggregateProcessManager[]>;
```

#### `requeueDeadMessages`

```typescript
requeueDeadMessages(input: RequeueDeadMessagesInput): Promise<RequeueDeadMessagesResult>;
```

#### `getFleetSummary`

```typescript
getFleetSummary(): Promise<ProcessFleetSummary[]>;
```

#### `getDeadLetters`

```typescript
getDeadLetters(input: GetDeadLettersInput): Promise<GetDeadLettersResult>;
```

#### `getDeadLetterCounts`

```typescript
getDeadLetterCounts(): Promise<DeadLetterCount[]>;
```

#### `getInstances`

```typescript
getInstances(input: GetInstancesInput): Promise<GetInstancesResult>;
```

#### `getUpcomingWakes`

```typescript
getUpcomingWakes(input: GetUpcomingWakesInput): Promise<ProcessWakeRow[]>;
```

#### `findInstanceDetail`

```typescript
findInstanceDetail(input: FindInstanceDetailInput): Promise<ProcessInstanceDetail | null>;
```

#### `getOutbox`

```typescript
getOutbox(input: GetOutboxInput): Promise<GetOutboxResult>;
```

#### `listRecentActions`

```typescript
listRecentActions(input: ListRecentActionsInput): Promise<ProcessAuditEntryView[]>;
```

#### `wakeNow`

```typescript
wakeNow(input: WakeNowInput): Promise<WakeNowResult>;
```

#### `redriveDeadInstance`

```typescript
redriveDeadInstance(input: RedriveDeadInstanceInput): Promise<RedriveDeadInstanceResult>;
```

#### `redriveDeadMessage`

```typescript
redriveDeadMessage(input: RedriveDeadMessageInput): Promise<RedriveDeadMessageResult>;
```

#### `discardDeadMessage`

```typescript
discardDeadMessage(input: DiscardDeadMessageInput): Promise<DiscardDeadMessageResult>;
```

#### `redriveDeadLetters`

```typescript
redriveDeadLetters(input: RedriveDeadLettersInput): Promise<RedriveDeadLettersResult>;
```

#### `discardDeadLetters`

```typescript
discardDeadLetters(input: DiscardDeadLettersInput): Promise<DiscardDeadLettersResult>;
```

#### `getOutboxAttempts`

```typescript
getOutboxAttempts(input: GetOutboxAttemptsInput): Promise<OutboxAttemptView[]>;
```

#### `releaseLapsedLease`

```typescript
releaseLapsedLease(input: ReleaseLapsedLeaseInput): Promise<ReleaseLapsedLeaseResult>;
```

#### `getHistory`

```typescript
getHistory(): Promise<ReplayHistoryEntry[]>;
```

#### `getHistoryPage`

```typescript
getHistoryPage(input: ReplayHistoryPageInput): Promise<ReplayHistoryPage>;
```

#### `findHistoryEntry`

```typescript
findHistoryEntry(input: FindHistoryEntryInput): Promise<ReplayHistoryEntry | null>;
```

#### `startReplay`

```typescript
startReplay(input: StartReplayInput): Promise<StartReplayResult>;
```

#### `getStatus`

```typescript
getStatus(): Promise<ReplayStatus>;
```

#### `cancelReplay`

```typescript
cancelReplay(): Promise<CancelReplayResult>;
```

#### `listAnomalies`

```typescript
listAnomalies(): Promise<Anomaly[]>;
```

#### `dismissAnomaly`

```typescript
dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean>;
```

#### `getCheckup`

The free checks; details only where `operator` is an install admin.

```typescript
getCheckup(input: { organizationId: string; operator: OpsOperator | null; }): Promise<CheckupAnswer>;
```

#### `runCheckup`

The checks that cost egress or money, run because someone asked.

```typescript
runCheckup(input: { organizationId: string; operator: OpsOperator | null; requestedBy?: string; } & ExplicitCheckInput): Promise<CheckupAnswer>;
```

#### `getUsageReport`

The install's report for an install admin; the organization's own figures otherwise.

```typescript
getUsageReport(input: { organizationId: string; operator: OpsOperator | null; }): Promise<UsageReportAnswer>;
```

#### `setUsageReportSwitches`

```typescript
setUsageReportSwitches(input: { organizationId: string; operator: OpsOperator | null; optionalMetricsOptOut?: boolean; hostnameOptOut?: boolean; }): Promise<UsageReportAnswer>;
```

#### `getProjectCheckup`

What `langwatch doctor` reads over a project key, which is never an install admin.

```typescript
getProjectCheckup(input: { projectId: string }): Promise<ProjectCheckupReport>;
```

#### `runProjectCheckup`

The paid checks over a project key; refused on LangWatch Cloud.

```typescript
runProjectCheckup(input: { projectId: string } & ExplicitCheckInput): Promise<CheckupResult>;
```

#### `getUpgradeStatus`

```typescript
getUpgradeStatus(): Promise<OpsUpgradeStatus>;
```

#### `getUpgradeAttentionNotice`

Self-hosted: whether every signed-in user sees the upgrade needs attention.

```typescript
getUpgradeAttentionNotice(): Promise<OpsUpgradeAttentionNotice>;
```

#### `listUpgradeReleases`

```typescript
listUpgradeReleases(): Promise<OpsUpgradeReleasePage>;
```

#### `listUpgradeSteps`

```typescript
listUpgradeSteps(input: OpsUpgradeListStepsInput): Promise<OpsUpgradeStepPage>;
```

#### `getUpgradeStep`

Refuses with `upgrade_not_found` when the ledger and the image hold no such step.

```typescript
getUpgradeStep(input: OpsUpgradeIdInput): Promise<OpsUpgradeStepDetail>;
```

#### `listUpgradeRuns`

```typescript
listUpgradeRuns(input: OpsUpgradeListRunsInput): Promise<OpsUpgradeRunPage>;
```

#### `getUpgradeRun`

Refuses with `upgrade_not_found` when the ledger holds no such run.

```typescript
getUpgradeRun(input: OpsUpgradeIdInput): Promise<OpsUpgradeRun>;
```

#### `listUpgradeTargets`

```typescript
listUpgradeTargets(): Promise<OpsUpgradeTargetSummary[]>;
```

#### `retryUpgradeStep`

Reopens a failed step for the worker; refuses a step not failed or not in the ledger.

```typescript
retryUpgradeStep(input: OpsUpgradeIdInput): Promise<OpsUpgradeStepDetail>;
```

## REST transport

### `adminRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/admin.rest.ts:32`       |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `POST /api/admin/impersonate` · `startAdminImpersonation`

Platform permission `ops:manage`. Credential `browser`. Declared at `src/transport/admin.rest.ts:37`.

Answers at `/api/admin/impersonate`, `/api/v1/admin/impersonate`.

```typescript
// Body: adminImpersonationRequestSchema, ../contract/src/features/admin/admin-operation.ts:99
interface Body {
  userIdToImpersonate: string;
  reason: string;
}
// Response: adminImpersonationStartedSchema, ../contract/src/features/admin/admin-operation.ts:130
interface Response {
  message: "Impersonation started";
}
```

#### `DELETE /api/admin/impersonate` · `stopAdminImpersonation`

Platform permission `ops:view`. Credential `browser`. Declared at `src/transport/admin.rest.ts:49`.

Answers at `/api/admin/impersonate`, `/api/v1/admin/impersonate`.

```typescript
// Body: adminEmptyRequestSchema, ../contract/src/features/admin/admin-operation.ts:103
type Body = Record<string, unknown>;
// Response: adminImpersonationStoppedSchema, ../contract/src/features/admin/admin-operation.ts:138
interface Response {
  message: "Impersonation ended";
}
```

#### `POST /api/admin/:resource` · `runAdminOperation`

Platform permission `ops:view`. Credential `browser`. Declared at `src/transport/admin.rest.ts:62`.

Answers at `/api/admin/:resource`, `/api/v1/admin/:resource`.

```typescript
// Params: adminResourceParamsSchema, ../contract/src/features/admin/admin-operation.ts:112
interface Params {
  resource: string;
}
type Body = z.infer<typeof adminOperationBodySchema>; // ../contract/src/features/admin/admin-operation.ts:121
// Response: adminOperationResponseSchema, ../contract/src/features/admin/admin-operation.ts:171
interface Response {
  data: unknown;
  total?: number;
}
```

### `checkupRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/checkup.rest.ts:14`     |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `GET /api/checkup` · `getCheckup`

Run the free checks of a self-hosted install

Permission `organization:view`. Declared at `src/transport/checkup.rest.ts:19`.

Answers at `/api/checkup`, `/api/v1/checkup`.

```typescript
type Response = z.infer<typeof projectCheckupReportSchema>; // ../contract/src/features/checkup/checkup.ts:201
```

#### `POST /api/checkup/run` · `runCheckup`

Run the checks that open a connection or spend money

Permission `organization:manage`. Declared at `src/transport/checkup.rest.ts:30`.

Answers at `/api/checkup/run`, `/api/v1/checkup/run`.

```typescript
type Body = z.infer<typeof explicitCheckInputSchema>; // ../contract/src/features/checkup/checkup.ts:189
type Response = z.infer<typeof checkupResultSchema>; // ../contract/src/features/checkup/checkup.ts:177
```

### `opsBugReportRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/ops-bug-report.rest.ts:43` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | project                                   |

#### `POST /api/bug-reports` · `submitBugReport`

File an issue report from a coding agent

Optional credential: the reporter may be struggling precisely because setup failed, so filing a report must never require a working login; a project credential only enriches the report. Declared at `src/transport/ops-bug-report.rest.ts:48`.

Answers at `/api/bug-reports`, `/api/v1/bug-reports`.

```typescript
// Body: submitBugReportSchema, ../contract/src/ops-bug-report.ts:152
interface Body {
  source: "cli" | "mcp";
  kind: "summary" | "full_session";
  title: string;
  summary?: string;
  sessionData?: string;
  sessionTruncated?: boolean;
  agent?: string;
  contactEmail?: string;
  cliVersion?: string;
  metadata?: Record<string, string | number | boolean>;
}
type Headers = z.infer<typeof bugReportIntakeHeadersSchema>; // ../contract/src/ops-bug-report.ts:125
// Response: inline, src/transport/ops-bug-report.rest.ts:67
type Response = unknown;
```

### `opsClickHouseExplainRest`

|             |                                                   |
| ----------- | ------------------------------------------------- |
| Declared at | `src/transport/ops-clickhouse-explain.rest.ts:34` |
| Base URL    | none: each route's path is its address            |
| Addressing  | literal                                           |
| Credential  | project                                           |

#### `POST /api/ops/clickhouse/explain` · `explainClickHouseQuery`

Explain a ClickHouse query as the read-only operator account

Authenticated: the deployment's operator secret is the bearer this door compares in constant time; no permission is asked, because operator is not an RBAC grain. Credential `internal_secret`. Declared at `src/transport/ops-clickhouse-explain.rest.ts:39`.

Answers at `/api/ops/clickhouse/explain`, `/api/v1/ops/clickhouse/explain`.

```typescript
// Body: opsExplainRequestSchema, ../contract/src/ops.responses.ts:478
interface Body {
  query: string;
  type?: "PLAN" | "SYNTAX" | "PIPELINE" | "AST" | "INDEXES";
}
// Response: inline, src/transport/ops-clickhouse-explain.rest.ts:56
type Response = unknown;
```

## tRPC transport

### `checkup`

Contract `../contract/src/features/checkup/checkup.trpc.ts:38`, router `src/transport/checkup.trpc.ts:12`.

| Procedure                        | Kind     | Gate                             | Input               | Output              |
| -------------------------------- | -------- | -------------------------------- | ------------------- | ------------------- |
| `checkup.status`                 | query    | Permission `organization:view`   | `organizationInput` | `checkupAnswer`     |
| `checkup.run`                    | mutation | Permission `organization:manage` | inline              | `checkupAnswer`     |
| `checkup.usageReport`            | query    | Permission `organization:view`   | `organizationInput` | `usageReportAnswer` |
| `checkup.setUsageReportSwitches` | mutation | Platform permission `ops:manage` | inline              | `usageReportAnswer` |

```typescript
// checkup.status
// Input: organizationInput, ../contract/src/features/checkup/checkup.trpc.ts:11
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof checkupAnswer>; // ../contract/src/features/checkup/checkup.trpc.ts:35

// checkup.run
// Input: z.object({ ...organizationInput.shape, ...explicitCheckInputSchema.shape }) (inline, ../contract/src/features/checkup/checkup.trpc.ts:44)
type Output = z.infer<typeof checkupAnswer>; // ../contract/src/features/checkup/checkup.trpc.ts:35

// checkup.usageReport
type Input = z.infer<typeof organizationInput>; // ../contract/src/features/checkup/checkup.trpc.ts:11
type Output = z.infer<typeof usageReportAnswer>; // ../contract/src/features/checkup/checkup.trpc.ts:36

// checkup.setUsageReportSwitches
// Input: inline, ../contract/src/features/checkup/checkup.trpc.ts:53
interface Input {
  organizationId: string;
  optionalMetricsOptOut?: boolean;
  hostnameOptOut?: boolean;
}
type Output = z.infer<typeof usageReportAnswer>; // ../contract/src/features/checkup/checkup.trpc.ts:36
```

### `bugReports`

Contract `../contract/src/ops-bug-report.trpc.ts:15`, router `src/transport/ops-bug-report.trpc.ts:10`.

| Procedure            | Kind  | Gate                           | Input                       | Output                   |
| -------------------- | ----- | ------------------------------ | --------------------------- | ------------------------ |
| `bugReports.getAll`  | query | Platform permission `ops:view` | `listBugReportsInputSchema` | `bugReportListingSchema` |
| `bugReports.getById` | query | Platform permission `ops:view` | `bugReportIdInputSchema`    | `bugReportSchema`        |

```typescript
// bugReports.getAll
// Input: listBugReportsInputSchema, ../contract/src/ops-bug-report.ts:109
interface Input {
  page?: number;
  pageSize?: number;
  search?: string;
}
type Output = z.infer<typeof bugReportListingSchema>; // ../contract/src/ops-bug-report.ts:96

// bugReports.getById
// Input: bugReportIdInputSchema, ../contract/src/ops-bug-report.ts:114
interface Input {
  id: string;
}
type Output = z.infer<typeof bugReportSchema>; // ../contract/src/ops-bug-report.ts:88
```

### `ops`

Contract `../contract/src/features/dashboard/ops-dashboard.trpc.ts:36`, router `src/transport/ops-dashboard.trpc.ts:12`.

| Procedure                  | Kind         | Gate                                                                                                                                  | Input                                 | Output                             |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------- |
| `ops.getScope`             | query        | No permission: the probe reads the caller's OWN operator reach and answers it, so refusing a non-operator would be refusing to say no | inline                                | `opsScopeProbeSchema`              |
| `ops.getDashboardSnapshot` | query        | Platform permission `ops:view`                                                                                                        | inline                                | inline                             |
| `ops.getBadgeCounts`       | query        | Platform permission `ops:view`                                                                                                        | inline                                | `opsApiGetBadgeCountsOutputSchema` |
| `ops.getSignUpHealth`      | query        | Platform permission `ops:view`                                                                                                        | `opsSignUpHealthInputSchema`          | `signUpHealthSchema`               |
| `ops.dashboardStream`      | subscription | Platform permission `ops:view`                                                                                                        | inline                                | `dashboardDataSchema`              |
| `ops.listParkedGroups`     | query        | Platform permission `ops:view`                                                                                                        | `opsListParkedQueueGroupsInputSchema` | `opsParkedGroupsPageSchema`        |
| `ops.listQueues`           | query        | Platform permission `ops:view`                                                                                                        | inline                                | inline                             |
| `ops.listScheduledJobs`    | query        | Platform permission `ops:view`                                                                                                        | `opsListScheduledJobsInputSchema`     | inline                             |
| `ops.listPausedSchedules`  | query        | Platform permission `ops:view`                                                                                                        | `opsListPausedSchedulesInputSchema`   | `opsPausedSchedulesPageSchema`     |
| `ops.listSchedulerActions` | query        | Platform permission `ops:view`                                                                                                        | `opsListSchedulerActionsInputSchema`  | inline                             |
| `ops.listInsightSchedules` | query        | Platform permission `ops:view`                                                                                                        | `opsListInsightSchedulesInputSchema`  | inline                             |
| `ops.setScheduleActive`    | mutation     | Platform permission `ops:manage`                                                                                                      | `opsSetScheduleActiveInputSchema`     | `opsScheduledJobSchema`            |
| `ops.clearScheduleSlot`    | mutation     | Platform permission `ops:manage`                                                                                                      | `opsScheduleIdInputSchema`            | `opsScheduledJobSchema`            |
| `ops.runScheduleNow`       | mutation     | Platform permission `ops:manage`                                                                                                      | `opsScheduleIdInputSchema`            | `opsScheduledJobSchema`            |

```typescript
// ops.getScope
// Input: inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:43
type Input = unknown;
// Output: opsScopeProbeSchema, ../contract/src/ops.responses.ts:66
interface Output {
  scope:
    | {
        kind: "none";
      }
    | {
        kind: "platform";
      };
}

// ops.getDashboardSnapshot
// Input: inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:47
type Input = unknown;
// Output: dashboardDataSchema.nullable() (inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:48)

// ops.getBadgeCounts
// Input: inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:56
type Input = unknown;
// Output: opsApiGetBadgeCountsOutputSchema, ../contract/src/ops.responses.ts:84
interface Output {
  blockedCount: number;
  dlqCount: number;
  computedAt: unknown | null;
}

// ops.getSignUpHealth
// Input: opsSignUpHealthInputSchema, ../contract/src/features/dashboard/ops-dashboard.ts:297
interface Input {
  fromMs: number;
  toMs: number;
}
// Output: signUpHealthSchema, ../contract/src/features/dashboard/ops-dashboard.ts:311
interface Output {
  organizationsFounded: number;
  orphanedOrganizations: number;
  orphanedRate: number;
  fromMs: number;
  toMs: number;
}

// ops.dashboardStream
// Input: inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:65
type Input = unknown;
type Output = z.infer<typeof dashboardDataSchema>; // ../contract/src/features/dashboard/ops-dashboard.ts:281

// ops.listParkedGroups
// Input: opsListParkedQueueGroupsInputSchema, ../contract/src/features/queue/ops-queue.ts:209
interface Input {
  queueName: string;
  tenantId: string;
  page?: number;
  pageSize?: number;
}
// Output: opsParkedGroupsPageSchema, ../contract/src/features/queue/ops-queue.ts:68
interface Output {
  groups: {
    groupId: string;
    pendingJobs: number;
    oldestJobMs: number | null;
    score: number;
    pipelineName: string | null;
  }[];
  total: number;
  page: number;
  pageSize: number;
}

// ops.listQueues
// Input: inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:78
type Input = unknown;
// Output: inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:79
type Output = {
  name: string;
  displayName: string;
  pendingGroupCount: number;
  blockedGroupCount: number;
  activeGroupCount: number;
  totalPendingJobs: number;
  dlqCount: number;
  parkedGroupCount: number;
}[];

// ops.listScheduledJobs
// Input: opsListScheduledJobsInputSchema, ../contract/src/ops-scheduler.ts:131
interface Input {
  limit?: number;
}
// Output: opsScheduledJobSchema.array() (inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:83)

// ops.listPausedSchedules
// Input: opsListPausedSchedulesInputSchema, ../contract/src/ops-scheduler.ts:149
interface Input {
  limit?: number;
}
type Output = z.infer<typeof opsPausedSchedulesPageSchema>; // ../contract/src/ops.responses.ts:293

// ops.listSchedulerActions
// Input: opsListSchedulerActionsInputSchema, ../contract/src/ops-scheduler.ts:158
interface Input {
  limit?: number;
}
// Output: inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:96
type Output = {
  id: string;
  at: string;
  action: string;
  scheduleId: string;
  projectId: string | null;
  actor: string | null;
}[];

// ops.listInsightSchedules
// Input: opsListInsightSchedulesInputSchema, ../contract/src/ops-scheduler.ts:140
interface Input {
  limit?: number;
}
// Output: opsInsightScheduleSchema.array() (inline, ../contract/src/features/dashboard/ops-dashboard.trpc.ts:101)

// ops.setScheduleActive
// Input: opsSetScheduleActiveInputSchema, ../contract/src/ops-scheduler.ts:168
interface Input {
  scheduleId: string;
  active: boolean;
}
type Output = z.infer<typeof opsScheduledJobSchema>; // ../contract/src/ops-scheduler.ts:26

// ops.clearScheduleSlot
// Input: opsScheduleIdInputSchema, ../contract/src/ops-scheduler.ts:122
interface Input {
  scheduleId: string;
}
type Output = z.infer<typeof opsScheduledJobSchema>; // ../contract/src/ops-scheduler.ts:26

// ops.runScheduleNow
type Input = z.infer<typeof opsScheduleIdInputSchema>; // ../contract/src/ops-scheduler.ts:122
type Output = z.infer<typeof opsScheduledJobSchema>; // ../contract/src/ops-scheduler.ts:26
```

### `ops`

Contract `../contract/src/features/event-log/ops-event-log.trpc.ts:40`, router `src/transport/ops-event-log.trpc.ts:12`.

| Procedure                     | Kind     | Gate                             | Input                                  | Output                          |
| ----------------------------- | -------- | -------------------------------- | -------------------------------------- | ------------------------------- |
| `ops.searchAggregates`        | query    | Platform permission `ops:view`   | `opsSearchAggregatesInputSchema`       | `opsAggregateSearchSchema`      |
| `ops.getEventLogSearchWindow` | query    | Platform permission `ops:view`   | inline                                 | `opsEventLogSearchWindowSchema` |
| `ops.loadAggregateEvents`     | query    | Platform permission `ops:view`   | `opsLoadAggregateEventsInputSchema`    | `opsAggregateEventsSchema`      |
| `ops.computeProjectionState`  | query    | Platform permission `ops:view`   | `opsComputeProjectionStateInputSchema` | `opsProjectionStateSchema`      |
| `ops.discoverAggregates`      | query    | Platform permission `ops:view`   | `opsDiscoverAggregatesInputSchema`     | `opsAggregateDiscoverySchema`   |
| `ops.searchTenants`           | query    | Platform permission `ops:view`   | `opsSearchTenantsInputSchema`          | `opsTenantSearchSchema`         |
| `ops.dryRunReplay`            | mutation | Platform permission `ops:manage` | `opsDryRunReplayInputSchema`           | `opsDryRunReplaySchema`         |
| `ops.getReplayHistory`        | query    | Platform permission `ops:view`   | inline                                 | inline                          |
| `ops.getReplayHistoryPage`    | query    | Platform permission `ops:view`   | `replayHistoryPageInputSchema`         | `replayHistoryPageSchema`       |
| `ops.getReplayRun`            | query    | Platform permission `ops:view`   | `opsGetReplayRunInputSchema`           | inline                          |
| `ops.startReplay`             | mutation | Platform permission `ops:manage` | `opsStartReplayInputSchema`            | `opsReplayStartedSchema`        |
| `ops.getReplayStatus`         | query    | Platform permission `ops:view`   | inline                                 | `replayStatusSchema`            |
| `ops.cancelReplay`            | mutation | Platform permission `ops:manage` | inline                                 | `opsReplayCancelledSchema`      |
| `ops.listAnomalies`           | query    | Platform permission `ops:view`   | inline                                 | `opsAnomalyListingSchema`       |
| `ops.dismissAnomaly`          | mutation | Platform permission `ops:manage` | `opsDismissAnomalyInputSchema`         | `opsAnomalyDismissedSchema`     |

```typescript
// ops.searchAggregates
// Input: opsSearchAggregatesInputSchema, ../contract/src/features/event-log/ops-event-log.ts:34
interface Input {
  query: string;
  tenantId?: string;
  sinceMs?: number;
}
// Output: opsAggregateSearchSchema, ../contract/src/ops.responses.ts:383
type Output = {
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  eventCount: number;
  lastEventTime: string;
}[];

// ops.getEventLogSearchWindow
// Input: inline, ../contract/src/features/event-log/ops-event-log.trpc.ts:51
type Input = unknown;
// Output: opsEventLogSearchWindowSchema, ../contract/src/ops.responses.ts:154
interface Output {
  searchLookbackDays: number;
  hotTierDays: number | null;
  hotTierEnvVar: string | null;
}

// ops.loadAggregateEvents
// Input: opsLoadAggregateEventsInputSchema, ../contract/src/features/event-log/ops-event-log.ts:45
interface Input {
  aggregateId: string;
  tenantId: string;
  limit?: number;
}
// Output: opsAggregateEventsSchema, ../contract/src/ops.responses.ts:389
type Output = {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  payload: unknown;
}[];

// ops.computeProjectionState
// Input: opsComputeProjectionStateInputSchema, ../contract/src/features/event-log/ops-event-log.ts:57
interface Input {
  aggregateId: string;
  tenantId: string;
  projectionName: string;
  eventIndex: number;
}
// Output: opsProjectionStateSchema, ../contract/src/ops.responses.ts:390
interface Output {
  state: unknown;
  appliedEventCount: number;
  projectionName: string;
  aggregateType: string;
}

// ops.discoverAggregates
// Input: opsDiscoverAggregatesInputSchema, ../contract/src/features/event-log/ops-event-log.ts:18
interface Input {
  projectionNames: string[];
  since: string;
  tenantIds?: string[];
}
// Output: opsAggregateDiscoverySchema, ../contract/src/ops.responses.ts:377
interface Output {
  projections: {
    projectionName: string;
    aggregateCount: number;
    tenantBreakdown: {
      tenantId: string;
      aggregateCount: number;
    }[];
  }[];
}

// ops.searchTenants
// Input: opsSearchTenantsInputSchema, ../contract/src/features/event-log/ops-event-log.ts:65
interface Input {
  query: string;
}
// Output: opsTenantSearchSchema, ../contract/src/ops.responses.ts:375
type Output = {
  id: string;
  name: string;
  slug: string;
}[];

// ops.dryRunReplay
// Input: opsDryRunReplayInputSchema, ../contract/src/features/event-log/ops-event-log.ts:77
interface Input {
  projectionNames: string[];
  since: string;
  tenantIds: string[];
  sampleSize?: number;
}
// Output: opsDryRunReplaySchema, ../contract/src/ops.responses.ts:404
interface Output {
  status: "coming_soon";
  message: string;
  projectionNames: string[];
  sampleSize: number;
}

// ops.getReplayHistory
// Input: inline, ../contract/src/features/event-log/ops-event-log.trpc.ts:75
type Input = unknown;
// Output: replayHistoryEntrySchema.array() (inline, ../contract/src/features/event-log/ops-event-log.trpc.ts:76)

// ops.getReplayHistoryPage
// Input: replayHistoryPageInputSchema, ../contract/src/features/event-log/ops-replay.ts:63
interface Input {
  cursor?: string;
  limit?: number;
}
type Output = z.infer<typeof replayHistoryPageSchema>; // ../contract/src/features/event-log/ops-replay.ts:80

// ops.getReplayRun
// Input: opsGetReplayRunInputSchema, ../contract/src/features/event-log/ops-event-log.ts:84
interface Input {
  runId: string;
}
// Output: replayHistoryEntrySchema.nullable() (inline, ../contract/src/features/event-log/ops-event-log.trpc.ts:84)

// ops.startReplay
// Input: opsStartReplayInputSchema, ../contract/src/features/event-log/ops-event-log.ts:98
interface Input {
  projectionNames: string[];
  since: string;
  tenantIds?: string[];
  aggregateIds?: string[];
  fullRebuild?: boolean;
  description: string;
}
// Output: opsReplayStartedSchema, ../contract/src/ops.responses.ts:409
interface Output {
  runId: string;
}

// ops.getReplayStatus
// Input: inline, ../contract/src/features/event-log/ops-event-log.trpc.ts:91
type Input = unknown;
type Output = z.infer<typeof replayStatusSchema>; // ../contract/src/features/event-log/ops-replay.ts:26

// ops.cancelReplay
// Input: inline, ../contract/src/features/event-log/ops-event-log.trpc.ts:95
type Input = unknown;
// Output: opsReplayCancelledSchema, ../contract/src/ops.responses.ts:415
interface Output {
  cancelled: boolean;
}

// ops.listAnomalies
// Input: inline, ../contract/src/features/event-log/ops-event-log.trpc.ts:103
type Input = unknown;
// Output: opsAnomalyListingSchema, ../contract/src/ops.responses.ts:420
interface Output {
  anomalies: {
    tenantId: string;
    kind: "rate_breaker";
    tier: "surface" | "hard";
    currentRate: number;
    baseline: number;
    triggeredAt: number;
    contributors?: Record<string, number>;
    reason: string;
  }[];
}

// ops.dismissAnomaly
// Input: opsDismissAnomalyInputSchema, ../contract/src/features/dashboard/ops-anomaly.ts:39
interface Input {
  tenantId: string;
  kind: "rate_breaker";
}
// Output: opsAnomalyDismissedSchema, ../contract/src/ops.responses.ts:427
interface Output {
  dismissed: boolean;
}
```

### `ops`

Contract `../contract/src/ops-operators.trpc.ts:16`, router `src/transport/ops-operators.trpc.ts:11`.

| Procedure                    | Kind     | Gate                             | Input                                  | Output                          |
| ---------------------------- | -------- | -------------------------------- | -------------------------------------- | ------------------------------- |
| `ops.listPlatformOperators`  | query    | Platform permission `ops:manage` | inline                                 | `opsPlatformOperatorListSchema` |
| `ops.grantPlatformOperator`  | mutation | Platform permission `ops:manage` | `opsGrantPlatformOperatorInputSchema`  | `opsPlatformOperatorSchema`     |
| `ops.revokePlatformOperator` | mutation | Platform permission `ops:manage` | `opsRevokePlatformOperatorInputSchema` | `opsOkOutputSchema`             |

```typescript
// ops.listPlatformOperators
// Input: inline, ../contract/src/ops-operators.trpc.ts:18
type Input = unknown;
// Output: opsPlatformOperatorListSchema, ../contract/src/ops-operators.ts:31
type Output = {
  grantId: string;
  userId: string;
  name: string | null;
  email: string | null;
  grantedAt: unknown;
}[];

// ops.grantPlatformOperator
// Input: opsGrantPlatformOperatorInputSchema, ../contract/src/ops-operators.ts:41
interface Input {
  email: string;
}
// Output: opsPlatformOperatorSchema, ../contract/src/ops-operators.ts:23
interface Output {
  grantId: string;
  userId: string;
  name: string | null;
  email: string | null;
  grantedAt: unknown;
}

// ops.revokePlatformOperator
// Input: opsRevokePlatformOperatorInputSchema, ../contract/src/ops-operators.ts:51
interface Input {
  grantId: string;
}
// Output: opsOkOutputSchema, ../contract/src/ops-feature-flag.ts:13
interface Output {
  ok: true;
}
```

### `ops`

Contract `../contract/src/ops-platform.trpc.ts:29`, router `src/transport/ops-platform.trpc.ts:15`.

| Procedure                 | Kind     | Gate                             | Input                               | Output                               |
| ------------------------- | -------- | -------------------------------- | ----------------------------------- | ------------------------------------ |
| `ops.listFeatureFlags`    | query    | Platform permission `ops:view`   | inline                              | `operatorFeatureFlagCatalogueSchema` |
| `ops.setFeatureFlag`      | mutation | Platform permission `ops:manage` | `opsSetFeatureFlagInputSchema`      | `opsOkOutputSchema`                  |
| `ops.setFeatureFlagRules` | mutation | Platform permission `ops:manage` | `opsSetFeatureFlagRulesInputSchema` | `opsOkOutputSchema`                  |
| `ops.clearFeatureFlag`    | mutation | Platform permission `ops:manage` | `opsFeatureFlagKeyInputSchema`      | `opsOkOutputSchema`                  |
| `ops.listBlobQueues`      | query    | Platform permission `ops:view`   | inline                              | `opsQueueNameListSchema`             |
| `ops.getBlobStoreStats`   | query    | Platform permission `ops:view`   | inline                              | `opsBlobStoreStatsSchema`            |
| `ops.listBlobs`           | query    | Platform permission `ops:view`   | `listBlobsInputSchema`              | `opsBlobPageSchema`                  |
| `ops.getBlob`             | query    | Platform permission `ops:view`   | `getBlobInputSchema`                | inline                               |
| `ops.runBlobCleanup`      | mutation | Platform permission `ops:manage` | `runBlobCleanupOperatorInputSchema` | `blobSweepReportSchema`              |
| `ops.deleteBlob`          | mutation | Platform permission `ops:manage` | `deleteBlobOperatorInputSchema`     | `deleteBlobResultSchema`             |

```typescript
// ops.listFeatureFlags
// Input: inline, ../contract/src/ops-platform.trpc.ts:36
type Input = unknown;
type Output = z.infer<typeof operatorFeatureFlagCatalogueSchema>; // ../../feature-flag/contract/src/feature-flag.schemas.ts:76

// ops.setFeatureFlag
// Input: opsSetFeatureFlagInputSchema, ../contract/src/ops-feature-flag.ts:30
interface Input {
  key: string;
  enabled: boolean;
}
type Output = z.infer<typeof opsOkOutputSchema>; // ../contract/src/ops-feature-flag.ts:13

// ops.setFeatureFlagRules
type Input = z.infer<typeof opsSetFeatureFlagRulesInputSchema>; // ../contract/src/ops-feature-flag.ts:45
type Output = z.infer<typeof opsOkOutputSchema>; // ../contract/src/ops-feature-flag.ts:13

// ops.clearFeatureFlag
// Input: opsFeatureFlagKeyInputSchema, ../contract/src/ops-feature-flag.ts:20
interface Input {
  key: string;
}
type Output = z.infer<typeof opsOkOutputSchema>; // ../contract/src/ops-feature-flag.ts:13

// ops.listBlobQueues
// Input: inline, ../contract/src/ops-platform.trpc.ts:52
type Input = unknown;
// Output: opsQueueNameListSchema, ../contract/src/ops.responses.ts:275
type Output = string[];

// ops.getBlobStoreStats
// Input: inline, ../contract/src/ops-platform.trpc.ts:56
type Input = unknown;
// Output: opsBlobStoreStatsSchema, ../contract/src/blob-store.ts:76
interface Output {
  queues: {
    queueName: string;
    sampledBlobs: number;
    sampledBytes: number;
    unreferenced: number;
    truncated: boolean;
  }[];
}

// ops.listBlobs
// Input: listBlobsInputSchema, ../contract/src/blob-store.ts:40
interface Input {
  queueName: string;
  cursor?: string | null;
  limit?: number;
  projectId?: string | null;
  sort?: "scan" | "largest" | "stalest" | "unreferenced" | "oldest_lapsed_lease";
}
type Output = z.infer<typeof opsBlobPageSchema>; // ../contract/src/blob-store.ts:61

// ops.getBlob
// Input: getBlobInputSchema, ../contract/src/blob-store.ts:50
interface Input {
  queueName: string;
  projectId: string;
  hash: string;
}
// Output: inline, ../contract/src/ops-platform.trpc.ts:65
type Output = {
  queueName: string;
  projectId: string;
  hash: string;
  sizeBytes: number;
  ttlSeconds: number | null;
  liveLeases: number;
  holderTokens: number;
  earliestLeaseDeadlineMs: number | null;
  sweepOutcome: string;
} | null;

// ops.runBlobCleanup
// Input: runBlobCleanupOperatorInputSchema, ../contract/src/blob-store.ts:159
interface Input {
  dryRun?: boolean;
  confirm?: "RECLAIM";
}
type Output = z.infer<typeof blobSweepReportSchema>; // ../contract/src/blob-store.ts:98

// ops.deleteBlob
// Input: deleteBlobOperatorInputSchema, ../contract/src/blob-store.ts:170
interface Input {
  queueName: string;
  projectId: string;
  hash: string;
  confirm: "DELETE";
}
// Output: deleteBlobResultSchema, ../contract/src/blob-store.ts:143
interface Output {
  deleted: boolean;
}
```

### `ops`

Contract `../contract/src/features/process/ops-process.trpc.ts:43`, router `src/transport/ops-process.trpc.ts:9`.

| Procedure                         | Kind     | Gate                             | Input                                     | Output                                 |
| --------------------------------- | -------- | -------------------------------- | ----------------------------------------- | -------------------------------------- |
| `ops.getAggregateProcessManagers` | query    | Platform permission `ops:view`   | `opsAggregateProcessManagersInputSchema`  | inline                                 |
| `ops.requeueDeadOutboxMessages`   | mutation | Platform permission `ops:manage` | `opsRequeueDeadOutboxMessagesInputSchema` | `opsProcessRequeuedSchema`             |
| `ops.listProcessFleet`            | query    | Platform permission `ops:view`   | inline                                    | inline                                 |
| `ops.listDeadLetters`             | query    | Platform permission `ops:view`   | `opsListDeadLettersInputSchema`           | `opsDeadLetterPageSchema`              |
| `ops.listDeadLetterCounts`        | query    | Platform permission `ops:view`   | inline                                    | inline                                 |
| `ops.listProcessInstances`        | query    | Platform permission `ops:view`   | `opsListProcessInstancesInputSchema`      | `opsProcessInstancePageSchema`         |
| `ops.listUpcomingWakes`           | query    | Platform permission `ops:view`   | `opsListUpcomingWakesInputSchema`         | inline                                 |
| `ops.getProcessInstance`          | query    | Platform permission `ops:view`   | `opsProcessRefInputSchema`                | inline                                 |
| `ops.listProcessOutbox`           | query    | Platform permission `ops:view`   | `opsListProcessOutboxInputSchema`         | `opsProcessOutboxPageSchema`           |
| `ops.listProcessActions`          | query    | Platform permission `ops:view`   | `opsListProcessActionsInputSchema`        | inline                                 |
| `ops.processWakeNow`              | mutation | Platform permission `ops:manage` | `opsProcessRefInputSchema`                | `opsProcessWokeSchema`                 |
| `ops.processRedriveDeadInstance`  | mutation | Platform permission `ops:manage` | `opsProcessRefInputSchema`                | `opsProcessRequeuedSchema`             |
| `ops.processRedriveDeadMessage`   | mutation | Platform permission `ops:manage` | `opsProcessMessageInputSchema`            | `opsProcessRedrivenMessageSchema`      |
| `ops.processDiscardDeadMessage`   | mutation | Platform permission `ops:manage` | `opsProcessMessageInputSchema`            | `opsProcessDiscardedMessageSchema`     |
| `ops.redriveDeadLetters`          | mutation | Platform permission `ops:manage` | `opsRedriveDeadLettersInputSchema`        | `opsProcessRedrivenDeadLettersSchema`  |
| `ops.discardDeadLetters`          | mutation | Platform permission `ops:manage` | `opsDiscardDeadLettersInputSchema`        | `opsProcessDiscardedDeadLettersSchema` |
| `ops.listOutboxAttempts`          | query    | Platform permission `ops:view`   | `opsListOutboxAttemptsInputSchema`        | inline                                 |
| `ops.processReleaseLapsedLease`   | mutation | Platform permission `ops:manage` | `opsProcessMessageInputSchema`            | `opsProcessReleasedLeaseSchema`        |

```typescript
// ops.getAggregateProcessManagers
// Input: opsAggregateProcessManagersInputSchema, ../contract/src/features/process/ops-process.ts:55
interface Input {
  aggregateType: string;
  tenantId: string;
  aggregateId: string;
}
// Output: aggregateProcessManagerSchema.array() (inline, ../contract/src/features/process/ops-process.trpc.ts:51)

// ops.requeueDeadOutboxMessages
// Input: opsRequeueDeadOutboxMessagesInputSchema, ../contract/src/features/process/ops-process.ts:67
interface Input {
  processName: string;
  tenantId: string;
  processKey: string;
  messageKeyPrefix?: string;
}
// Output: opsProcessRequeuedSchema, ../contract/src/ops.responses.ts:333
interface Output {
  requeued: number;
}

// ops.listProcessFleet
// Input: inline, ../contract/src/features/process/ops-process.trpc.ts:64
type Input = unknown;
// Output: inline, ../contract/src/features/process/ops-process.trpc.ts:65
type Output = {
  processName: string;
  pipelineName: string;
  scheduled: boolean;
  instances: number;
  overdueWakes: number;
  pendingMessages: number;
  overduePending: number;
  lapsedLeases: number;
  deadMessages: number;
}[];

// ops.listDeadLetters
// Input: opsListDeadLettersInputSchema, ../contract/src/features/process/ops-process.ts:79
interface Input {
  processName?: string;
  page?: number;
  pageSize?: number;
}
type Output = z.infer<typeof opsDeadLetterPageSchema>; // ../contract/src/ops.responses.ts:302

// ops.listDeadLetterCounts
// Input: inline, ../contract/src/features/process/ops-process.trpc.ts:78
type Input = unknown;
// Output: inline, ../contract/src/features/process/ops-process.trpc.ts:79
type Output = {
  processName: string;
  count: number;
  oldestUpdatedAt: number;
}[];

// ops.listProcessInstances
// Input: opsListProcessInstancesInputSchema, ../contract/src/features/process/ops-process.ts:92
interface Input {
  processName?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}
type Output = z.infer<typeof opsProcessInstancePageSchema>; // ../contract/src/ops.responses.ts:312

// ops.listUpcomingWakes
// Input: opsListUpcomingWakesInputSchema, ../contract/src/features/process/ops-process.ts:101
interface Input {
  limit?: number;
}
// Output: inline, ../contract/src/features/process/ops-process.trpc.ts:88
type Output = {
  processName: string;
  projectId: string;
  processKey: string;
  nextWakeAt: number;
}[];

// ops.getProcessInstance
// Input: opsProcessRefInputSchema, ../contract/src/features/process/ops-process.ts:33
interface Input {
  processName: string;
  projectId: string;
  processKey: string;
}
// Output: inline, ../contract/src/features/process/ops-process.trpc.ts:92
type Output = {
  ref: {
    processName: string;
    projectId: string;
    processKey: string;
  };
  tenantId: string;
  state: unknown;
  revision: number;
  nextWakeAt: number | null;
  updatedAt: number;
} | null;

// ops.listProcessOutbox
// Input: opsListProcessOutboxInputSchema, ../contract/src/features/process/ops-process.ts:112
interface Input {
  processName: string;
  projectId: string;
  processKey: string;
  page?: number;
  pageSize?: number;
}
type Output = z.infer<typeof opsProcessOutboxPageSchema>; // ../contract/src/ops.responses.ts:322

// ops.listProcessActions
// Input: opsListProcessActionsInputSchema, ../contract/src/features/process/ops-process.ts:121
interface Input {
  limit?: number;
}
// Output: inline, ../contract/src/features/process/ops-process.trpc.ts:100
type Output = {
  id: string;
  createdAt: number;
  action: string;
  targetId: string;
  actorUserId: string | null;
  metadata: unknown;
}[];

// ops.processWakeNow
type Input = z.infer<typeof opsProcessRefInputSchema>; // ../contract/src/features/process/ops-process.ts:33
// Output: opsProcessWokeSchema, ../contract/src/ops.responses.ts:336
interface Output {
  woke: boolean;
}

// ops.processRedriveDeadInstance
type Input = z.infer<typeof opsProcessRefInputSchema>; // ../contract/src/features/process/ops-process.ts:33
type Output = z.infer<typeof opsProcessRequeuedSchema>; // ../contract/src/ops.responses.ts:333

// ops.processRedriveDeadMessage
// Input: opsProcessMessageInputSchema, ../contract/src/features/process/ops-process.ts:44
interface Input {
  processName: string;
  projectId: string;
  processKey: string;
  messageId: string;
}
// Output: opsProcessRedrivenMessageSchema, ../contract/src/ops.responses.ts:342
interface Output {
  redriven: boolean;
}

// ops.processDiscardDeadMessage
type Input = z.infer<typeof opsProcessMessageInputSchema>; // ../contract/src/features/process/ops-process.ts:44
// Output: opsProcessDiscardedMessageSchema, ../contract/src/ops.responses.ts:348
interface Output {
  discarded: boolean;
}

// ops.redriveDeadLetters
// Input: opsRedriveDeadLettersInputSchema, ../contract/src/features/process/ops-process.ts:130
interface Input {
  processName?: string;
}
// Output: opsProcessRedrivenDeadLettersSchema, ../contract/src/ops.responses.ts:354
interface Output {
  redriven: number;
}

// ops.discardDeadLetters
// Input: opsDiscardDeadLettersInputSchema, ../contract/src/features/process/ops-process.ts:150
interface Input {
  processName?: string;
  confirm?: "DISCARD ALL";
}
// Output: opsProcessDiscardedDeadLettersSchema, ../contract/src/ops.responses.ts:360
interface Output {
  discarded: number;
}

// ops.listOutboxAttempts
// Input: opsListOutboxAttemptsInputSchema, ../contract/src/features/process/ops-process.ts:160
interface Input {
  outboxId: string;
  projectId: string;
}
// Output: inline, ../contract/src/features/process/ops-process.trpc.ts:139
type Output = {
  id: string;
  attempt: number;
  occurredAt: number;
  outcome: "retry_scheduled" | "dead";
  errorType: string;
  errorMessage: string;
  retryAfterMs: number | null;
}[];

// ops.processReleaseLapsedLease
type Input = z.infer<typeof opsProcessMessageInputSchema>; // ../contract/src/features/process/ops-process.ts:44
// Output: opsProcessReleasedLeaseSchema, ../contract/src/ops.responses.ts:366
interface Output {
  released: boolean;
}
```

### `ops`

Contract `../contract/src/features/queue/ops-queue.trpc.ts:48`, router `src/transport/ops-queue.trpc.ts:9`.

| Procedure                    | Kind     | Gate                             | Input                                | Output                               |
| ---------------------------- | -------- | -------------------------------- | ------------------------------------ | ------------------------------------ |
| `ops.listGroups`             | query    | Platform permission `ops:view`   | `opsListQueueGroupsInputSchema`      | `opsQueueGroupsPageSchema`           |
| `ops.getGroupDetail`         | query    | Platform permission `ops:view`   | `opsQueueGroupInputSchema`           | `groupInfoSchema`                    |
| `ops.getGrafanaLinkConfig`   | query    | Platform permission `ops:view`   | inline                               | `opsGrafanaLinkConfigSchema`         |
| `ops.getBlockedSummary`      | query    | Platform permission `ops:view`   | inline                               | `opsBlockedSummarySchema`            |
| `ops.getGroupJobs`           | query    | Platform permission `ops:view`   | `opsListQueueGroupJobsInputSchema`   | `opsQueueJobsPageSchema`             |
| `ops.unblockGroup`           | mutation | Platform permission `ops:manage` | `opsQueueGroupInputSchema`           | `opsQueueUnblockedGroupSchema`       |
| `ops.unblockAll`             | mutation | Platform permission `ops:manage` | `opsQueueNameInputSchema`            | `opsQueueUnblockedAllSchema`         |
| `ops.reapStrandedGroups`     | mutation | Platform permission `ops:manage` | inline                               | `opsQueueReapedStrandedGroupsSchema` |
| `ops.drainGroup`             | mutation | Platform permission `ops:manage` | `opsQueueGroupInputSchema`           | `opsQueueDrainedGroupSchema`         |
| `ops.pausePipeline`          | mutation | Platform permission `ops:manage` | `opsQueuePipelineInputSchema`        | inline                               |
| `ops.unpausePipeline`        | mutation | Platform permission `ops:manage` | `opsQueuePipelineInputSchema`        | inline                               |
| `ops.pauseTenant`            | mutation | Platform permission `ops:manage` | `opsQueueTenantInputSchema`          | inline                               |
| `ops.unpauseTenant`          | mutation | Platform permission `ops:manage` | `opsQueueTenantInputSchema`          | inline                               |
| `ops.listPausedTenants`      | query    | Platform permission `ops:view`   | `opsQueueNameInputSchema`            | `opsQueueNameListSchema`             |
| `ops.drainTenant`            | mutation | Platform permission `ops:manage` | `opsDrainQueueTenantInputSchema`     | `opsQueueDrainedTenantSchema`        |
| `ops.retryBlocked`           | mutation | Platform permission `ops:manage` | `opsRetryBlockedQueueJobInputSchema` | `opsQueueUnblockedGroupSchema`       |
| `ops.listProjections`        | query    | Platform permission `ops:view`   | inline                               | `opsPipelineRegistrationsSchema`     |
| `ops.listDlqGroups`          | query    | Platform permission `ops:view`   | `opsQueueNameInputSchema`            | inline                               |
| `ops.listAllDlqGroups`       | query    | Platform permission `ops:view`   | inline                               | inline                               |
| `ops.listPausedKeys`         | query    | Platform permission `ops:view`   | `opsQueueNameInputSchema`            | `opsQueueNameListSchema`             |
| `ops.drainAllBlockedPreview` | query    | Platform permission `ops:view`   | `opsQueueFilterInputSchema`          | `opsQueueDrainPreviewSchema`         |
| `ops.moveToDlq`              | mutation | Platform permission `ops:manage` | `opsQueueGroupInputSchema`           | `opsQueueMovedToDlqSchema`           |
| `ops.moveAllBlockedToDlq`    | mutation | Platform permission `ops:manage` | `opsQueueFilterInputSchema`          | `opsQueueMovedAllToDlqSchema`        |
| `ops.replayFromDlq`          | mutation | Platform permission `ops:manage` | `opsQueueGroupInputSchema`           | `opsQueueReplayedFromDlqSchema`      |
| `ops.replayAllFromDlq`       | mutation | Platform permission `ops:manage` | `opsQueueFilterInputSchema`          | `opsQueueReplayedAllFromDlqSchema`   |
| `ops.redriveManyFromDlq`     | mutation | Platform permission `ops:manage` | `opsQueueGroupIdsInputSchema`        | `opsQueueRedrivenDlqGroupsSchema`    |
| `ops.discardManyFromDlq`     | mutation | Platform permission `ops:manage` | `opsQueueGroupIdsInputSchema`        | `opsQueueDiscardedDlqGroupsSchema`   |
| `ops.canaryRedrive`          | mutation | Platform permission `ops:manage` | `opsQueueCanaryInputSchema`          | `opsQueueCanaryRedrivenSchema`       |
| `ops.canaryUnblock`          | mutation | Platform permission `ops:manage` | `opsQueueCanaryInputSchema`          | `opsQueueCanaryUnblockedSchema`      |

```typescript
// ops.listGroups
// Input: opsListQueueGroupsInputSchema, ../contract/src/features/queue/ops-queue.ts:220
interface Input {
  queueName: string;
  page?: number;
  pageSize?: number;
}
type Output = z.infer<typeof opsQueueGroupsPageSchema>; // ../contract/src/features/queue/ops-queue.ts:55

// ops.getGroupDetail
// Input: opsQueueGroupInputSchema, ../contract/src/features/queue/ops-queue.ts:155
interface Input {
  queueName: string;
  groupId: string;
}
type Output = z.infer<typeof groupInfoSchema>; // ../contract/src/features/dashboard/ops-dashboard.ts:46

// ops.getGrafanaLinkConfig
// Input: inline, ../contract/src/features/queue/ops-queue.trpc.ts:63
type Input = unknown;
// Output: opsGrafanaLinkConfigSchema, ../contract/src/ops.responses.ts:169
type Output = {
  baseUrl: string;
  tempoDatasourceUid?: string;
  lokiDatasourceUid?: string;
} | null;

// ops.getBlockedSummary
// Input: inline, ../contract/src/features/queue/ops-queue.trpc.ts:67
type Input = unknown;
// Output: opsBlockedSummarySchema, ../contract/src/features/queue/ops-queue.ts:87
interface Output {
  totalBlocked: number;
  clusters: {
    normalizedMessage: string;
    sampleMessage: string;
    sampleStack: string | null;
    count: number;
    pipelineName: string | null;
    queueName: string;
    sampleGroupIds: string[];
  }[];
}

// ops.getGroupJobs
// Input: opsListQueueGroupJobsInputSchema, ../contract/src/features/queue/ops-queue.ts:232
interface Input {
  queueName: string;
  groupId: string;
  page?: number;
  pageSize?: number;
}
type Output = z.infer<typeof opsQueueJobsPageSchema>; // ../contract/src/features/queue/ops-queue.ts:42

// ops.unblockGroup
type Input = z.infer<typeof opsQueueGroupInputSchema>; // ../contract/src/features/queue/ops-queue.ts:155
// Output: opsQueueUnblockedGroupSchema, ../contract/src/ops.responses.ts:182
interface Output {
  wasBlocked: boolean;
}

// ops.unblockAll
// Input: opsQueueNameInputSchema, ../contract/src/features/queue/ops-queue.ts:145
interface Input {
  queueName: string;
}
// Output: opsQueueUnblockedAllSchema, ../contract/src/ops.responses.ts:188
interface Output {
  unblockedCount: number;
}

// ops.reapStrandedGroups
// Input: inline, ../contract/src/features/queue/ops-queue.trpc.ts:84
type Input = unknown;
// Output: opsQueueReapedStrandedGroupsSchema, ../contract/src/features/queue/ops-queue.ts:285
interface Output {
  strandedGroups: number;
  strandedJobs: number;
  deletedGroups: number;
  failedDeletes: number;
  totalPendingNow: number | null;
}

// ops.drainGroup
type Input = z.infer<typeof opsQueueGroupInputSchema>; // ../contract/src/features/queue/ops-queue.ts:155
// Output: opsQueueDrainedGroupSchema, ../contract/src/ops.responses.ts:194
interface Output {
  jobsRemoved: number;
}

// ops.pausePipeline
// Input: opsQueuePipelineInputSchema, ../contract/src/features/queue/ops-queue.ts:243
interface Input {
  queueName: string;
  key: string;
}
// Output: inline, ../contract/src/features/queue/ops-queue.trpc.ts:93
type Output = unknown;

// ops.unpausePipeline
type Input = z.infer<typeof opsQueuePipelineInputSchema>; // ../contract/src/features/queue/ops-queue.ts:243
// Output: inline, ../contract/src/features/queue/ops-queue.trpc.ts:97
type Output = unknown;

// ops.pauseTenant
// Input: opsQueueTenantInputSchema, ../contract/src/features/queue/ops-queue.ts:187
interface Input {
  queueName: string;
  tenantId: string;
}
// Output: inline, ../contract/src/features/queue/ops-queue.trpc.ts:101
type Output = unknown;

// ops.unpauseTenant
type Input = z.infer<typeof opsQueueTenantInputSchema>; // ../contract/src/features/queue/ops-queue.ts:187
// Output: inline, ../contract/src/features/queue/ops-queue.trpc.ts:105
type Output = unknown;

// ops.listPausedTenants
type Input = z.infer<typeof opsQueueNameInputSchema>; // ../contract/src/features/queue/ops-queue.ts:145
type Output = z.infer<typeof opsQueueNameListSchema>; // ../contract/src/ops.responses.ts:275

// ops.drainTenant
// Input: opsDrainQueueTenantInputSchema, ../contract/src/features/queue/ops-queue.ts:256
interface Input {
  queueName: string;
  tenantId: string;
  groupIdContains?: string;
}
// Output: opsQueueDrainedTenantSchema, ../contract/src/ops.responses.ts:203
interface Output {
  groupsDrained: number;
  jobsDrained: number;
}

// ops.retryBlocked
// Input: opsRetryBlockedQueueJobInputSchema, ../contract/src/features/queue/ops-queue.ts:267
interface Input {
  queueName: string;
  groupId: string;
  jobId: string;
}
type Output = z.infer<typeof opsQueueUnblockedGroupSchema>; // ../contract/src/ops.responses.ts:182

// ops.listProjections
// Input: inline, ../contract/src/features/queue/ops-queue.trpc.ts:120
type Input = unknown;
type Output = z.infer<typeof opsPipelineRegistrationsSchema>; // ../contract/src/ops.responses.ts:137

// ops.listDlqGroups
type Input = z.infer<typeof opsQueueNameInputSchema>; // ../contract/src/features/queue/ops-queue.ts:145
// Output: inline, ../contract/src/features/queue/ops-queue.trpc.ts:125
type Output = {
  groupId: string;
  error: string | null;
  errorStack: string | null;
  pipelineName: string | null;
  jobCount: number;
  movedAt: number | null;
}[];

// ops.listAllDlqGroups
// Input: inline, ../contract/src/features/queue/ops-queue.trpc.ts:128
type Input = unknown;
// Output: inline, ../contract/src/features/queue/ops-queue.trpc.ts:129
type Output = {
  groupId: string;
  error: string | null;
  errorStack: string | null;
  pipelineName: string | null;
  jobCount: number;
  movedAt: number | null;
  queueName: string;
  queueDisplayName: string;
}[];

// ops.listPausedKeys
type Input = z.infer<typeof opsQueueNameInputSchema>; // ../contract/src/features/queue/ops-queue.ts:145
type Output = z.infer<typeof opsQueueNameListSchema>; // ../contract/src/ops.responses.ts:275

// ops.drainAllBlockedPreview
// Input: opsQueueFilterInputSchema, ../contract/src/features/queue/ops-queue.ts:166
interface Input {
  queueName: string;
  pipelineFilter?: string;
  errorFilter?: string;
}
// Output: opsQueueDrainPreviewSchema, ../contract/src/features/queue/ops-queue.ts:123
interface Output {
  totalAffected: number;
  byPipeline: {
    name: string;
    count: number;
  }[];
  byError: {
    message: string;
    count: number;
  }[];
}

// ops.moveToDlq
type Input = z.infer<typeof opsQueueGroupInputSchema>; // ../contract/src/features/queue/ops-queue.ts:155
// Output: opsQueueMovedToDlqSchema, ../contract/src/ops.responses.ts:209
interface Output {
  jobsMoved: number;
}

// ops.moveAllBlockedToDlq
type Input = z.infer<typeof opsQueueFilterInputSchema>; // ../contract/src/features/queue/ops-queue.ts:166
// Output: opsQueueMovedAllToDlqSchema, ../contract/src/ops.responses.ts:218
interface Output {
  movedCount: number;
  jobsMoved: number;
}

// ops.replayFromDlq
type Input = z.infer<typeof opsQueueGroupInputSchema>; // ../contract/src/features/queue/ops-queue.ts:155
// Output: opsQueueReplayedFromDlqSchema, ../contract/src/ops.responses.ts:224
interface Output {
  jobsReplayed: number;
}

// ops.replayAllFromDlq
type Input = z.infer<typeof opsQueueFilterInputSchema>; // ../contract/src/features/queue/ops-queue.ts:166
// Output: opsQueueReplayedAllFromDlqSchema, ../contract/src/ops.responses.ts:233
interface Output {
  replayedCount: number;
  jobsReplayed: number;
}

// ops.redriveManyFromDlq
// Input: opsQueueGroupIdsInputSchema, ../contract/src/features/queue/ops-queue.ts:197
interface Input {
  queueName: string;
  groupIds: string[];
}
// Output: opsQueueRedrivenDlqGroupsSchema, ../contract/src/ops.responses.ts:242
interface Output {
  redrivenCount: number;
  jobsRedriven: number;
}

// ops.discardManyFromDlq
type Input = z.infer<typeof opsQueueGroupIdsInputSchema>; // ../contract/src/features/queue/ops-queue.ts:197
// Output: opsQueueDiscardedDlqGroupsSchema, ../contract/src/ops.responses.ts:251
interface Output {
  discardedCount: number;
  jobsDiscarded: number;
}

// ops.canaryRedrive
// Input: opsQueueCanaryInputSchema, ../contract/src/features/queue/ops-queue.ts:177
interface Input {
  queueName: string;
  count?: number;
  pipelineFilter?: string;
}
// Output: opsQueueCanaryRedrivenSchema, ../contract/src/ops.responses.ts:261
interface Output {
  redrivenCount: number;
  groupIds: string[];
}

// ops.canaryUnblock
type Input = z.infer<typeof opsQueueCanaryInputSchema>; // ../contract/src/features/queue/ops-queue.ts:177
// Output: opsQueueCanaryUnblockedSchema, ../contract/src/ops.responses.ts:270
interface Output {
  unblockedCount: number;
  groupIds: string[];
}
```

### `ops.upgrade`

Contract `../contract/src/features/migrations/ops-upgrade.ts:343`, router `src/transport/ops-upgrade.trpc.ts:16`.

| Procedure                                               | Kind     | Gate                                                                                                                                                                                 | Input                                             | Output                                |
| ------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------- |
| `ops.upgrade.status`                                    | query    | Platform permission `ops:view`                                                                                                                                                       | inline                                            | `opsUpgradeStatusSchema`              |
| `ops.upgrade.attentionNotice`                           | query    | No permission: answers one boolean, whether the last upgrade needs attention, so every signed-in user can be told to contact their operator; it names no step, error or organization | inline                                            | `opsUpgradeAttentionNoticeSchema`     |
| `ops.upgrade.listReleases`                              | query    | Platform permission `ops:view`                                                                                                                                                       | inline                                            | `opsUpgradeReleasePageSchema`         |
| `ops.upgrade.listSteps`                                 | query    | Platform permission `ops:view`                                                                                                                                                       | `opsUpgradeListStepsInputSchema`                  | `opsUpgradeStepPageSchema`            |
| `ops.upgrade.getStep`                                   | query    | Platform permission `ops:view`                                                                                                                                                       | `opsUpgradeIdInputSchema`                         | `opsUpgradeStepDetailSchema`          |
| `ops.upgrade.listRuns`                                  | query    | Platform permission `ops:view`                                                                                                                                                       | `opsUpgradeListRunsInputSchema`                   | `opsUpgradeRunPageSchema`             |
| `ops.upgrade.getRun`                                    | query    | Platform permission `ops:view`                                                                                                                                                       | `opsUpgradeIdInputSchema`                         | `opsUpgradeRunSchema`                 |
| `ops.upgrade.listTargets`                               | query    | Platform permission `ops:view`                                                                                                                                                       | inline                                            | inline                                |
| `ops.upgrade.retryStep`                                 | mutation | Platform permission `ops:manage`                                                                                                                                                     | `opsUpgradeIdInputSchema`                         | `opsUpgradeStepDetailSchema`          |
| `ops.upgrade.listSystemMigrations`                      | query    | Platform permission `ops:view`                                                                                                                                                       | inline                                            | inline                                |
| `ops.upgrade.listTenants`                               | query    | Platform permission `ops:view`                                                                                                                                                       | `opsUpgradeListTenantsInputSchema`                | `opsUpgradeTenantPageSchema`          |
| `ops.upgrade.listMigrationEnrollments`                  | query    | Platform permission `ops:view`                                                                                                                                                       | inline                                            | `opsMigrationEnrollmentListingSchema` |
| `ops.upgrade.searchMigrationOrganizations`              | query    | Platform permission `ops:view`                                                                                                                                                       | `opsSearchMigrationOrganizationsInputSchema`      | inline                                |
| `ops.upgrade.enrollMigrationTenant`                     | mutation | Platform permission `ops:manage`                                                                                                                                                     | `opsEnrollMigrationTenantInputSchema`             | `opsMigrationEnrolledSchema`          |
| `ops.upgrade.enrollMigrationCohort`                     | mutation | Platform permission `ops:manage`                                                                                                                                                     | `opsEnrollMigrationCohortInputSchema`             | `opsMigrationCohortResultSchema`      |
| `ops.upgrade.withdrawMigrationTenant`                   | mutation | Platform permission `ops:manage`                                                                                                                                                     | `opsMigrationTenantInputSchema`                   | `opsMigrationWithdrawnSchema`         |
| `ops.upgrade.runSystemMigrationForOrganization`         | mutation | Platform permission `ops:manage`                                                                                                                                                     | `opsRunSystemMigrationForOrganizationInputSchema` | `opsMigrationTargetedRunResultSchema` |
| `ops.upgrade.runSystemMigrationPass`                    | mutation | Platform permission `ops:manage`                                                                                                                                                     | inline                                            | `opsMigrationPassStartedSchema`       |
| `ops.upgrade.assertSystemMigrationLegacyWritersDrained` | mutation | Platform permission `ops:manage`                                                                                                                                                     | `opsAssertLegacyWritersDrainedInputSchema`        | `opsMigrationDrainAssertedSchema`     |
| `ops.upgrade.rollBackSystemMigrationTenant`             | mutation | Platform permission `ops:manage`                                                                                                                                                     | `opsRollBackSystemMigrationTenantInputSchema`     | `opsMigrationRolledBackSchema`        |

```typescript
// ops.upgrade.status
// Input: inline, ../contract/src/features/migrations/ops-upgrade.ts:346
type Input = unknown;
type Output = z.infer<typeof opsUpgradeStatusSchema>; // ../contract/src/features/migrations/ops-upgrade.ts:132

// ops.upgrade.attentionNotice
// Input: inline, ../contract/src/features/migrations/ops-upgrade.ts:354
type Input = unknown;
// Output: opsUpgradeAttentionNoticeSchema, ../contract/src/features/migrations/ops-upgrade.ts:340
interface Output {
  show: boolean;
}

// ops.upgrade.listReleases
// Input: inline, ../contract/src/features/migrations/ops-upgrade.ts:359
type Input = unknown;
// Output: opsUpgradeReleasePageSchema, ../contract/src/features/migrations/ops-upgrade.ts:251
interface Output {
  items: {
    release: string | null;
    installed: boolean;
    image: boolean;
    stepCount: number;
    counts: Record<string, number>;
  }[];
  cursor: string | null;
}

// ops.upgrade.listSteps
// Input: opsUpgradeListStepsInputSchema, ../contract/src/features/migrations/ops-upgrade.ts:275
interface Input {
  release?: string | null;
  mode?: string;
  status?: string;
}
type Output = z.infer<typeof opsUpgradeStepPageSchema>; // ../contract/src/features/migrations/ops-upgrade.ts:258

// ops.upgrade.getStep
// Input: opsUpgradeIdInputSchema, ../contract/src/features/migrations/ops-upgrade.ts:313
interface Input {
  id: string;
}
type Output = z.infer<typeof opsUpgradeStepDetailSchema>; // ../contract/src/features/migrations/ops-upgrade.ts:217

// ops.upgrade.listRuns
// Input: opsUpgradeListRunsInputSchema, ../contract/src/features/migrations/ops-upgrade.ts:286
interface Input {
  cursor?: string | null;
  limit?: number;
}
// Output: opsUpgradeRunPageSchema, ../contract/src/features/migrations/ops-upgrade.ts:262
interface Output {
  items: {
    id: string;
    kind: string;
    release: string | null;
    startedAt: string;
    finishedAt: string | null;
    outcome: string | null;
  }[];
  cursor: string | null;
}

// ops.upgrade.getRun
type Input = z.infer<typeof opsUpgradeIdInputSchema>; // ../contract/src/features/migrations/ops-upgrade.ts:313
type Output = z.infer<typeof opsUpgradeRunSchema>; // ../contract/src/features/migrations/ops-upgrade.ts:243

// ops.upgrade.listTargets
// Input: inline, ../contract/src/features/migrations/ops-upgrade.ts:383
type Input = unknown;
// Output: inline, ../contract/src/features/migrations/ops-upgrade.ts:384
type Output = {
  target: string;
  version: string | null;
  outstanding: number;
  lastError: string | null;
  route: "present" | "missing" | "malformed";
}[];

// ops.upgrade.retryStep
type Input = z.infer<typeof opsUpgradeIdInputSchema>; // ../contract/src/features/migrations/ops-upgrade.ts:313
type Output = z.infer<typeof opsUpgradeStepDetailSchema>; // ../contract/src/features/migrations/ops-upgrade.ts:217

// ops.upgrade.listSystemMigrations
// Input: inline, ../contract/src/features/migrations/ops-upgrade.ts:397
type Input = unknown;
// Output: opsMigrationOverviewSchema.array() (inline, ../contract/src/features/migrations/ops-upgrade.ts:398)

// ops.upgrade.listTenants
// Input: opsUpgradeListTenantsInputSchema, ../contract/src/features/migrations/ops-upgrade.ts:300
interface Input {
  step?: string;
  state?: "migrated" | "finalized" | "parked" | "rolled_back";
  cursor?: string | null;
  limit?: number;
}
// Output: opsUpgradeTenantPageSchema, ../contract/src/features/migrations/ops-upgrade.ts:307
interface Output {
  items: {
    migrationName: string;
    tenantId: string;
    status: "migrated" | "finalized" | "parked" | "rolled_back";
    report: unknown;
    updatedAt: unknown;
  }[];
  cursor: string | null;
}

// ops.upgrade.listMigrationEnrollments
// Input: inline, ../contract/src/features/migrations/ops-upgrade.ts:410
type Input = unknown;
// Output: opsMigrationEnrollmentListingSchema, ../contract/src/features/migrations/ops-system-migration.ts:160
interface Output {
  enrollments: {
    organizationId: string;
    organizationName: string | null;
    migrationName: string;
    enrolledByUserId: string;
    enrolledByLabel: string | null;
    createdAt: unknown;
  }[];
}

// ops.upgrade.searchMigrationOrganizations
// Input: opsSearchMigrationOrganizationsInputSchema, ../contract/src/features/migrations/ops-system-migration.ts:57
interface Input {
  query: string;
}
// Output: inline, ../contract/src/features/migrations/ops-upgrade.ts:419
type Output = {
  id: string;
  name: string;
}[];

// ops.upgrade.enrollMigrationTenant
// Input: opsEnrollMigrationTenantInputSchema, ../contract/src/features/migrations/ops-system-migration.ts:35
interface Input {
  organizationId: string;
  migrationName: string;
  confirm?: "ENROLL";
}
// Output: opsMigrationEnrolledSchema, ../contract/src/ops.responses.ts:438
interface Output {
  enrolled: true;
}

// ops.upgrade.enrollMigrationCohort
// Input: opsEnrollMigrationCohortInputSchema, ../contract/src/features/migrations/ops-system-migration.ts:48
interface Input {
  migrationName: string;
  sampleSize: number;
  includeEnterprise?: boolean;
  includePrivateDataplane?: boolean;
  confirm?: "ENROLL";
}
// Output: opsMigrationCohortResultSchema, ../contract/src/features/migrations/ops-system-migration.ts:228
interface Output {
  enrolled: {
    id: string;
    name: string;
  }[];
  eligibleCount: number;
}

// ops.upgrade.withdrawMigrationTenant
// Input: opsMigrationTenantInputSchema, ../contract/src/features/migrations/ops-system-migration.ts:22
interface Input {
  organizationId: string;
  migrationName: string;
}
// Output: opsMigrationWithdrawnSchema, ../contract/src/ops.responses.ts:444
interface Output {
  withdrawn: true;
}

// ops.upgrade.runSystemMigrationForOrganization
// Input: opsRunSystemMigrationForOrganizationInputSchema, ../contract/src/features/migrations/ops-system-migration.ts:69
interface Input {
  organizationId: string;
  migrationName: string;
  confirm?: "RUN";
}
// Output: opsMigrationTargetedRunResultSchema, ../contract/src/features/migrations/ops-system-migration.ts:244
interface Output {
  status: "migrated" | "finalized" | "parked" | "rolled_back" | null;
  waiting: boolean;
}

// ops.upgrade.runSystemMigrationPass
// Input: inline, ../contract/src/features/migrations/ops-upgrade.ts:462
type Input = Record<string, unknown>;
// Output: opsMigrationPassStartedSchema, ../contract/src/ops.responses.ts:450
interface Output {
  started: true;
}

// ops.upgrade.assertSystemMigrationLegacyWritersDrained
// Input: opsAssertLegacyWritersDrainedInputSchema, ../contract/src/features/migrations/ops-system-migration.ts:81
interface Input {
  migrationName: string;
  tenantId: string;
  minimumWriterGeneration: string;
  confirm?: "DRAIN LEGACY WRITERS";
}
// Output: opsMigrationDrainAssertedSchema, ../contract/src/ops.responses.ts:456
interface Output {
  asserted: true;
}

// ops.upgrade.rollBackSystemMigrationTenant
// Input: opsRollBackSystemMigrationTenantInputSchema, ../contract/src/features/migrations/ops-system-migration.ts:93
interface Input {
  migrationName: string;
  tenantId: string;
  confirm?: "ROLL BACK";
}
// Output: opsMigrationRolledBackSchema, ../contract/src/ops.responses.ts:462
interface Output {
  rolledBack: true;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `ops_anomaly_detection` (aggregate `global`)

Declared at `src/eventing/ops-anomaly-detection.pipeline.ts:30`.

| Kind            | Name               | Handles                                                                  | Declared at                                         |
| --------------- | ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------- |
| process manager | `anomalyDetection` | every 1 min (`ANOMALY_DETECTION_INTERVAL_MS`); intents `detect` (outbox) | `src/eventing/ops-anomaly-detection.pipeline.ts:35` |

### Pipeline `ops_group_queue_reaper` (aggregate `global`)

Declared at `src/eventing/ops-group-queue-reaper.pipeline.ts:34`.

| Kind            | Name               | Handles                                                                                | Declared at                                          |
| --------------- | ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| process manager | `groupQueueReaper` | every 1 h (`GROUP_QUEUE_REAPER_INTERVAL_MS = 60 * 60 * 1000`); intents `reap` (outbox) | `src/eventing/ops-group-queue-reaper.pipeline.ts:39` |

### Pipeline `ops_platform_operator_seed` (aggregate `platform_operator_seed`)

Declared at `src/eventing/ops-platform-operator-seed.pipeline.ts:55`. Events: `platformOperatorSeedRecordedEventSchema`.

| Kind            | Name                         | Handles                                                                                               | Declared at                                              |
| --------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| command         | `recordPlatformOperatorSeed` | –                                                                                                     | `src/eventing/ops-platform-operator-seed.pipeline.ts:60` |
| process manager | `platformOperatorSeed`       | every 1 min (`PLATFORM_OPERATOR_SEED_WAKE_INTERVAL_MS = 60 * 1000`); intents `grant`, `seed` (outbox) | `src/eventing/ops-platform-operator-seed.pipeline.ts:68` |
| peer subscriber | `firstUserCreated`           | `lw.user.created` from [user](../../user/README.md)                                                   | `src/eventing/ops-platform-operator-seed.pipeline.ts:61` |

### Pipeline `ops_projection_replay` (aggregate `projection_replay`)

Declared at `src/eventing/ops-projection-replay.pipeline.ts:43`. Events: `projectionReplayRequestedEventSchema`.

| Kind            | Name                      | Handles                    | Declared at                                         |
| --------------- | ------------------------- | -------------------------- | --------------------------------------------------- |
| command         | `requestProjectionReplay` | –                          | `src/eventing/ops-projection-replay.pipeline.ts:48` |
| process manager | `projectionReplay`        | intents `execute` (outbox) | `src/eventing/ops-projection-replay.pipeline.ts:49` |

### Pipeline `ops_storage_stats` (aggregate `global`)

Declared at `src/eventing/ops-storage-stats.pipeline.ts:27`.

| Kind            | Name           | Handles                                                              | Declared at                                     |
| --------------- | -------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| process manager | `storageStats` | every 15 s (`STORAGE_STATS_INTERVAL_MS`); intents `measure` (outbox) | `src/eventing/ops-storage-stats.pipeline.ts:32` |

### Pipeline `ops_system_migrations` (aggregate `system_migration_pass`)

Declared at `src/eventing/ops-system-migrations.pipeline.ts:66`. Events: `systemMigrationPassRequestedEventSchema`, `tenantMigrationRolledBackEventSchema`.

| Kind            | Name                              | Handles                                                                       | Declared at                                         |
| --------------- | --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| command         | `requestSystemMigrationPass`      | –                                                                             | `src/eventing/ops-system-migrations.pipeline.ts:71` |
| command         | `recordTenantMigrationRolledBack` | –                                                                             | `src/eventing/ops-system-migrations.pipeline.ts:72` |
| process manager | `systemMigrationPass`             | every 1 min (`SYSTEM_MIGRATION_WAKE_INTERVAL_MS`); intents `runPass` (outbox) | `src/eventing/ops-system-migrations.pipeline.ts:73` |

### Pipeline `ops_usage_report` (aggregate `global`)

Declared at `src/eventing/ops-usage-report.pipeline.ts:25`.

| Kind            | Name          | Handles                                                                               | Declared at                                    |
| --------------- | ------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| process manager | `usageReport` | every 1 h (`USAGE_REPORT_WAKE_INTERVAL_MS = 60 * 60 * 1000`); intents `send` (outbox) | `src/eventing/ops-usage-report.pipeline.ts:30` |

### Pipeline `ops_upgrade_alerts` (aggregate `global`)

Declared at `src/features/upgrades/eventing/ops-upgrade-alerts.pipeline.ts:33`.

| Kind            | Name            | Handles                                                                          | Declared at                                                        |
| --------------- | --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| process manager | `upgradeAlerts` | every 1 h (`UPGRADE_ALERTS_INTERVAL_MS = 60 * 60_000`); intents `check` (outbox) | `src/features/upgrades/eventing/ops-upgrade-alerts.pipeline.ts:38` |

### Tasks

Run by the tasks process, before serve.

| Task                             | Class                             | Declared at                                          |
| -------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `process-manager-purge`          | `ProcessManagerPurgeTask`         | `src/tasks/process-manager-purge.task.ts:135`        |
| `credentials-reseal`             | `CredentialsResealTask`           | `src/tasks/credentials-reseal.task.ts:273`           |
| `grant-platform-operator`        | `GrantPlatformOperatorTask`       | `src/tasks/grant-platform-operator.task.ts:30`       |
| `system-migrations-pass`         | `SystemMigrationsPassTask`        | `src/tasks/system-migrations-pass.task.ts:15`        |
| `request-system-migrations-pass` | `SystemMigrationsPassRequestTask` | `src/tasks/system-migrations-pass-request.task.ts:8` |

## Configuration

| Kind   | Leaf                             | Environment variable                | Declared at                        |
| ------ | -------------------------------- | ----------------------------------- | ---------------------------------- |
| secret | `licensePrivateKey`              | `LANGWATCH_LICENSE_PRIVATE_KEY`     | `src/app/ops.app.ts:811`           |
| secret | `slackBugReportsBotToken`        | `SLACK_BUG_REPORTS_BOT_TOKEN`       | `src/app/ops.app.ts:812`           |
| secret | `credentials`                    | `CREDENTIALS_SECRET`                | `src/app/ops.app.ts:814`           |
| secret | `credentialsFallback`            | `NEXTAUTH_SECRET`                   | `src/app/ops.app.ts:815`           |
| secret | `credentialsPrevious`            | `CREDENTIALS_SECRET_PREVIOUS`       | `src/app/ops.app.ts:816`           |
| config | `apiKey`                         | `LANGWATCH_OPS_API_KEY`             | `../contract/src/ops.config.ts:30` |
| config | `clickhouseOpsUrl`               | `CLICKHOUSE_OPS_URL`                | `../contract/src/ops.config.ts:32` |
| config | `usageStats.disabled`            | `DISABLE_USAGE_STATS`               | `../contract/src/ops.config.ts:34` |
| config | `usageStats.installMethod`       | `INSTALL_METHOD`                    | `../contract/src/ops.config.ts:35` |
| config | `usageStats.chartVersion`        | `LANGWATCH_CHART_VERSION`           | `../contract/src/ops.config.ts:37` |
| config | `collectClickHouseBackupMetrics` | `CLICKHOUSE_BACKUP_METRICS_ENABLED` | `../contract/src/ops.config.ts:39` |
| config | `productAnalytics.key`           | `POSTHOG_KEY`                       | `../contract/src/ops.config.ts:46` |
| config | `productAnalytics.host`          | `POSTHOG_HOST`                      | `../contract/src/ops.config.ts:46` |
| config | `grafana`                        | `GRAFANA_BASE_URL`                  | `../contract/src/ops.config.ts:48` |
| config | `bugReportSlackChannel`          | `SLACK_BUG_REPORTS_CHANNEL`         | `../contract/src/ops.config.ts:50` |
| config | `slackApiBase`                   | `SLACK_API_BASE`                    | `../contract/src/ops.config.ts:52` |
| config | `cloudOps`                       | `LANGWATCH_CLOUD_OPS`               | `../contract/src/ops.config.ts:54` |
| config | `adminEmails`                    | `ADMIN_EMAILS`                      | `../contract/src/ops.config.ts:56` |
| config | `nodeEnvironment`                | `NODE_ENV`                          | `../contract/src/ops.config.ts:58` |
| config | `isSaas`                         | `IS_SAAS`                           | `../contract/src/ops.config.ts:59` |
| config | `publicBaseUrl`                  | `BASE_HOST`                         | `../contract/src/ops.config.ts:60` |
| config | `serviceVersion`                 | `SERVICE_VERSION`                   | `../contract/src/ops.config.ts:62` |
| config | `otelResourceAttributes`         | `OTEL_RESOURCE_ATTRIBUTES`          | `../contract/src/ops.config.ts:63` |

<!-- readme:generated:end -->
