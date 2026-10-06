# @langwatch/ops-process

The server half of [ops](../README.md). Platform administration for every deployment: admin operations, impersonation, blob storage inspection and the operator views over queues and the scheduler.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("ops").withRepositories(opsRepositories).withApi(OpsModule).withTransports(adminRest, opsBugReportRest, opsClickHouseExplainRest, opsTrpcTransport, opsBugReportTrpcTransport, checkupTrpcTransport, checkupRest).withTransportFacts(…).withEventing(usageReportEventing).withEventing(anomalyDetectionEventing).withEventing(storageStatsEventing).withEventing(projectionReplayEventing).withEventing(systemMigrationsEventing).withEventing(platformOperatorSeedEventing).withTasks(…)`, `src/ops.module.ts:24`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`OpsApi`)

Peers call these through the token, declared at `../contract/src/ops.api.ts:393`; nothing else in this package is public.

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
submitBugReport(input: { report: SubmitBugReport; callerKey: string; apiToken?: string | undefined; projectIdHint?: string | null; }): Promise<{ id: string }>;
```

#### `receiveBugReport`

One report as the intake door received it, answered in the bodies released builds read.

```typescript
receiveBugReport(input: { report: SubmitBugReport; forwardedFor: string | null; credential: Readonly<{ token: string; projectId: string | null }> | null; }): Promise<OpsDoorAnswer>;
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

## REST transport

### `adminRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/admin.rest.ts:30`       |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `POST /api/admin/impersonate` · `startAdminImpersonation`

Platform permission `ops:manage`. Credential `browser`. Declared at `src/transport/admin.rest.ts:35`.

Answers at `/api/admin/impersonate`, `/api/v1/admin/impersonate`.

```typescript
type Body = z.infer<typeof adminImpersonationRequestSchema>; // ../contract/src/admin-backoffice.ts:75
type Response = z.infer<typeof adminImpersonationStartedSchema>; // ../contract/src/admin-backoffice.ts:88
```

#### `DELETE /api/admin/impersonate` · `stopAdminImpersonation`

Platform permission `ops:manage`. Credential `browser`. Declared at `src/transport/admin.rest.ts:45`.

Answers at `/api/admin/impersonate`, `/api/v1/admin/impersonate`.

```typescript
type Body = z.infer<typeof adminEmptyRequestSchema>; // ../contract/src/admin-backoffice.ts:80
type Response = z.infer<typeof adminImpersonationStoppedSchema>; // ../contract/src/admin-backoffice.ts:91
```

#### `POST /api/admin/:resource` · `runAdminOperation`

Platform permission `ops:view`. Credential `browser`. Declared at `src/transport/admin.rest.ts:55`.

Answers at `/api/admin/:resource`, `/api/v1/admin/:resource`.

```typescript
type Params = z.infer<typeof adminResourceParamsSchema>; // ../contract/src/admin-backoffice.ts:82
type Body = z.infer<typeof adminOperationBodySchema>; // ../contract/src/admin-backoffice.ts:83
type Response = z.infer<typeof adminOperationResponseSchema>; // ../contract/src/admin-backoffice.ts:106
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
type Response = z.infer<typeof projectCheckupReportSchema>; // ../contract/src/checkup.ts:181
```

#### `POST /api/checkup/run` · `runCheckup`

Run the checks that open a connection or spend money

Permission `organization:manage`. Declared at `src/transport/checkup.rest.ts:30`.

Answers at `/api/checkup/run`, `/api/v1/checkup/run`.

```typescript
type Body = z.infer<typeof explicitCheckInputSchema>; // ../contract/src/checkup.ts:174
type Response = z.infer<typeof checkupResultSchema>; // ../contract/src/checkup.ts:167
```

### `opsBugReportRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/ops-bug-report.rest.ts:54` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | project                                   |

#### `POST /api/bug-reports` · `submitBugReport`

File an issue report from a coding agent

Public: the reporter may be struggling precisely because setup failed, so filing a report must never require a working login; a project credential only enriches the report. Declared at `src/transport/ops-bug-report.rest.ts:59`.

Answers at `/api/bug-reports`, `/api/v1/bug-reports`.

```typescript
type Body = z.infer<typeof submitBugReportSchema>; // ../contract/src/ops-bug-report.ts:113
type Headers = z.infer<typeof bugReportIntakeHeadersSchema>; // ../contract/src/ops-bug-report.ts:104
// Response: "protocol" (inline, src/transport/ops-bug-report.rest.ts:75)
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
type Body = z.infer<typeof opsExplainRequestSchema>; // ../contract/src/ops.responses.ts:272
// Response: "protocol" (inline, src/transport/ops-clickhouse-explain.rest.ts:54)
```

## tRPC transport

### `checkup`

Contract `../contract/src/checkup.trpc.ts:34`, router `src/transport/checkup.trpc.ts:12`.

| Procedure                        | Kind     | Gate                             | Input               | Output              |
| -------------------------------- | -------- | -------------------------------- | ------------------- | ------------------- |
| `checkup.status`                 | query    | Permission `organization:view`   | `organizationInput` | `checkupAnswer`     |
| `checkup.run`                    | mutation | Permission `organization:manage` | inline              | `checkupAnswer`     |
| `checkup.usageReport`            | query    | Permission `organization:view`   | `organizationInput` | `usageReportAnswer` |
| `checkup.setUsageReportSwitches` | mutation | Permission `organization:manage` | inline              | `usageReportAnswer` |

### `bugReports`

Contract `../contract/src/ops-bug-report.trpc.ts:15`, router `src/transport/ops-bug-report.trpc.ts:10`.

| Procedure            | Kind  | Gate                           | Input                       | Output                   |
| -------------------- | ----- | ------------------------------ | --------------------------- | ------------------------ |
| `bugReports.getAll`  | query | Platform permission `ops:view` | `listBugReportsInputSchema` | `bugReportListingSchema` |
| `bugReports.getById` | query | Platform permission `ops:view` | `bugReportIdInputSchema`    | `bugReportSchema`        |

### `ops`

Contract `../contract/src/ops-dashboard.trpc.ts:27`, router `src/transport/ops-dashboard.trpc.ts:12`.

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
| `ops.setScheduleActive`    | mutation     | Platform permission `ops:manage`                                                                                                      | `opsSetScheduleActiveInputSchema`     | `opsScheduledJobSchema`            |
| `ops.clearScheduleSlot`    | mutation     | Platform permission `ops:manage`                                                                                                      | `opsScheduleIdInputSchema`            | `opsScheduledJobSchema`            |
| `ops.runScheduleNow`       | mutation     | Platform permission `ops:manage`                                                                                                      | `opsScheduleIdInputSchema`            | `opsScheduledJobSchema`            |

### `ops`

Contract `../contract/src/ops-event-log.trpc.ts:35`, router `src/transport/ops-event-log.trpc.ts:12`.

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
| `ops.getReplayRun`            | query    | Platform permission `ops:view`   | `opsGetReplayRunInputSchema`           | inline                          |
| `ops.startReplay`             | mutation | Platform permission `ops:manage` | `opsStartReplayInputSchema`            | `opsReplayStartedSchema`        |
| `ops.getReplayStatus`         | query    | Platform permission `ops:view`   | inline                                 | `replayStatusSchema`            |
| `ops.cancelReplay`            | mutation | Platform permission `ops:manage` | inline                                 | `opsReplayCancelledSchema`      |
| `ops.listAnomalies`           | query    | Platform permission `ops:view`   | inline                                 | `opsAnomalyListingSchema`       |
| `ops.dismissAnomaly`          | mutation | Platform permission `ops:manage` | `opsDismissAnomalyInputSchema`         | `opsAnomalyDismissedSchema`     |

### `ops`

Contract `../contract/src/ops-operators.trpc.ts:16`, router `src/transport/ops-operators.trpc.ts:11`.

| Procedure                    | Kind     | Gate                             | Input                                  | Output                          |
| ---------------------------- | -------- | -------------------------------- | -------------------------------------- | ------------------------------- |
| `ops.listPlatformOperators`  | query    | Platform permission `ops:manage` | inline                                 | `opsPlatformOperatorListSchema` |
| `ops.grantPlatformOperator`  | mutation | Platform permission `ops:manage` | `opsGrantPlatformOperatorInputSchema`  | `opsPlatformOperatorSchema`     |
| `ops.revokePlatformOperator` | mutation | Platform permission `ops:manage` | `opsRevokePlatformOperatorInputSchema` | `opsOkOutputSchema`             |

### `ops`

Contract `../contract/src/ops-platform.trpc.ts:50`, router `src/transport/ops-platform.trpc.ts:15`.

| Procedure                                       | Kind     | Gate                             | Input                                             | Output                                |
| ----------------------------------------------- | -------- | -------------------------------- | ------------------------------------------------- | ------------------------------------- |
| `ops.listFeatureFlags`                          | query    | Platform permission `ops:view`   | inline                                            | `operatorFeatureFlagCatalogueSchema`  |
| `ops.setFeatureFlag`                            | mutation | Platform permission `ops:manage` | `opsSetFeatureFlagInputSchema`                    | `opsOkOutputSchema`                   |
| `ops.setFeatureFlagRules`                       | mutation | Platform permission `ops:manage` | `opsSetFeatureFlagRulesInputSchema`               | `opsOkOutputSchema`                   |
| `ops.clearFeatureFlag`                          | mutation | Platform permission `ops:manage` | `opsFeatureFlagKeyInputSchema`                    | `opsOkOutputSchema`                   |
| `ops.listBlobQueues`                            | query    | Platform permission `ops:view`   | inline                                            | `opsQueueNameListSchema`              |
| `ops.getBlobStoreStats`                         | query    | Platform permission `ops:view`   | inline                                            | `opsBlobStoreStatsSchema`             |
| `ops.listBlobs`                                 | query    | Platform permission `ops:view`   | `listBlobsInputSchema`                            | `opsBlobPageSchema`                   |
| `ops.getBlob`                                   | query    | Platform permission `ops:view`   | `getBlobInputSchema`                              | inline                                |
| `ops.runBlobCleanup`                            | mutation | Platform permission `ops:manage` | `runBlobCleanupOperatorInputSchema`               | `blobSweepReportSchema`               |
| `ops.deleteBlob`                                | mutation | Platform permission `ops:manage` | `deleteBlobOperatorInputSchema`                   | `deleteBlobResultSchema`              |
| `ops.listSystemMigrations`                      | query    | Platform permission `ops:view`   | inline                                            | inline                                |
| `ops.listMigrationEnrollments`                  | query    | Platform permission `ops:view`   | inline                                            | `opsMigrationEnrollmentListingSchema` |
| `ops.searchMigrationOrganizations`              | query    | Platform permission `ops:view`   | `opsSearchMigrationOrganizationsInputSchema`      | inline                                |
| `ops.enrollMigrationTenant`                     | mutation | Platform permission `ops:manage` | `opsEnrollMigrationTenantInputSchema`             | `opsMigrationEnrolledSchema`          |
| `ops.enrollMigrationCohort`                     | mutation | Platform permission `ops:manage` | `opsEnrollMigrationCohortInputSchema`             | `opsMigrationCohortResultSchema`      |
| `ops.withdrawMigrationTenant`                   | mutation | Platform permission `ops:manage` | `opsMigrationTenantInputSchema`                   | `opsMigrationWithdrawnSchema`         |
| `ops.runSystemMigrationForOrganization`         | mutation | Platform permission `ops:manage` | `opsRunSystemMigrationForOrganizationInputSchema` | `opsMigrationTargetedRunResultSchema` |
| `ops.runSystemMigrationPass`                    | mutation | Platform permission `ops:manage` | inline                                            | `opsMigrationPassStartedSchema`       |
| `ops.assertSystemMigrationLegacyWritersDrained` | mutation | Platform permission `ops:manage` | `opsAssertLegacyWritersDrainedInputSchema`        | `opsMigrationDrainAssertedSchema`     |
| `ops.rollBackSystemMigrationTenant`             | mutation | Platform permission `ops:manage` | `opsRollBackSystemMigrationTenantInputSchema`     | `opsMigrationRolledBackSchema`        |

### `ops`

Contract `../contract/src/ops-process.trpc.ts:43`, router `src/transport/ops-process.trpc.ts:9`.

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

### `ops`

Contract `../contract/src/ops-queue.trpc.ts:47`, router `src/transport/ops-queue.trpc.ts:9`.

| Procedure                    | Kind     | Gate                             | Input                                | Output                             |
| ---------------------------- | -------- | -------------------------------- | ------------------------------------ | ---------------------------------- |
| `ops.listGroups`             | query    | Platform permission `ops:view`   | `opsListQueueGroupsInputSchema`      | `opsQueueGroupsPageSchema`         |
| `ops.getGroupDetail`         | query    | Platform permission `ops:view`   | `opsQueueGroupInputSchema`           | `groupInfoSchema`                  |
| `ops.getGrafanaLinkConfig`   | query    | Platform permission `ops:view`   | inline                               | `opsGrafanaLinkConfigSchema`       |
| `ops.getBlockedSummary`      | query    | Platform permission `ops:view`   | inline                               | `opsBlockedSummarySchema`          |
| `ops.getGroupJobs`           | query    | Platform permission `ops:view`   | `opsListQueueGroupJobsInputSchema`   | `opsQueueJobsPageSchema`           |
| `ops.unblockGroup`           | mutation | Platform permission `ops:manage` | `opsQueueGroupInputSchema`           | `opsQueueUnblockedGroupSchema`     |
| `ops.unblockAll`             | mutation | Platform permission `ops:manage` | `opsQueueNameInputSchema`            | `opsQueueUnblockedAllSchema`       |
| `ops.drainGroup`             | mutation | Platform permission `ops:manage` | `opsQueueGroupInputSchema`           | `opsQueueDrainedGroupSchema`       |
| `ops.pausePipeline`          | mutation | Platform permission `ops:manage` | `opsQueuePipelineInputSchema`        | inline                             |
| `ops.unpausePipeline`        | mutation | Platform permission `ops:manage` | `opsQueuePipelineInputSchema`        | inline                             |
| `ops.pauseTenant`            | mutation | Platform permission `ops:manage` | `opsQueueTenantInputSchema`          | inline                             |
| `ops.unpauseTenant`          | mutation | Platform permission `ops:manage` | `opsQueueTenantInputSchema`          | inline                             |
| `ops.listPausedTenants`      | query    | Platform permission `ops:view`   | `opsQueueNameInputSchema`            | `opsQueueNameListSchema`           |
| `ops.drainTenant`            | mutation | Platform permission `ops:manage` | `opsDrainQueueTenantInputSchema`     | `opsQueueDrainedTenantSchema`      |
| `ops.retryBlocked`           | mutation | Platform permission `ops:manage` | `opsRetryBlockedQueueJobInputSchema` | `opsQueueUnblockedGroupSchema`     |
| `ops.listProjections`        | query    | Platform permission `ops:view`   | inline                               | `opsPipelineRegistrationsSchema`   |
| `ops.listDlqGroups`          | query    | Platform permission `ops:view`   | `opsQueueNameInputSchema`            | inline                             |
| `ops.listAllDlqGroups`       | query    | Platform permission `ops:view`   | inline                               | inline                             |
| `ops.listPausedKeys`         | query    | Platform permission `ops:view`   | `opsQueueNameInputSchema`            | `opsQueueNameListSchema`           |
| `ops.drainAllBlockedPreview` | query    | Platform permission `ops:view`   | `opsQueueFilterInputSchema`          | `opsQueueDrainPreviewSchema`       |
| `ops.moveToDlq`              | mutation | Platform permission `ops:manage` | `opsQueueGroupInputSchema`           | `opsQueueMovedToDlqSchema`         |
| `ops.moveAllBlockedToDlq`    | mutation | Platform permission `ops:manage` | `opsQueueFilterInputSchema`          | `opsQueueMovedAllToDlqSchema`      |
| `ops.replayFromDlq`          | mutation | Platform permission `ops:manage` | `opsQueueGroupInputSchema`           | `opsQueueReplayedFromDlqSchema`    |
| `ops.replayAllFromDlq`       | mutation | Platform permission `ops:manage` | `opsQueueFilterInputSchema`          | `opsQueueReplayedAllFromDlqSchema` |
| `ops.redriveManyFromDlq`     | mutation | Platform permission `ops:manage` | `opsQueueGroupIdsInputSchema`        | `opsQueueRedrivenDlqGroupsSchema`  |
| `ops.discardManyFromDlq`     | mutation | Platform permission `ops:manage` | `opsQueueGroupIdsInputSchema`        | `opsQueueDiscardedDlqGroupsSchema` |
| `ops.canaryRedrive`          | mutation | Platform permission `ops:manage` | `opsQueueCanaryInputSchema`          | `opsQueueCanaryRedrivenSchema`     |
| `ops.canaryUnblock`          | mutation | Platform permission `ops:manage` | `opsQueueCanaryInputSchema`          | `opsQueueCanaryUnblockedSchema`    |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `ops_anomaly_detection` (aggregate `global`)

Declared at `src/eventing/ops-anomaly-detection.pipeline.ts:30`.

| Kind            | Name               | Handles                                                                  | Declared at                                         |
| --------------- | ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------- |
| process manager | `anomalyDetection` | every 1 min (`ANOMALY_DETECTION_INTERVAL_MS`); intents `detect` (outbox) | `src/eventing/ops-anomaly-detection.pipeline.ts:35` |

### Pipeline `ops_platform_operator_seed` (aggregate `platform_operator_seed`)

Declared at `src/eventing/ops-platform-operator-seed.pipeline.ts:53`. Events: `platformOperatorSeedRecordedEventSchema`.

| Kind            | Name                         | Handles                                                                                               | Declared at                                              |
| --------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| command         | `recordPlatformOperatorSeed` | –                                                                                                     | `src/eventing/ops-platform-operator-seed.pipeline.ts:58` |
| process manager | `platformOperatorSeed`       | every 1 min (`PLATFORM_OPERATOR_SEED_WAKE_INTERVAL_MS = 60 * 1000`); intents `grant`, `seed` (outbox) | `src/eventing/ops-platform-operator-seed.pipeline.ts:59` |

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

Declared at `src/eventing/ops-system-migrations.pipeline.ts:57`. Events: `systemMigrationPassRequestedEventSchema`.

| Kind            | Name                         | Handles                                                                                      | Declared at                                         |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| command         | `requestSystemMigrationPass` | –                                                                                            | `src/eventing/ops-system-migrations.pipeline.ts:62` |
| process manager | `systemMigrationPass`        | every 1 h (`SYSTEM_MIGRATION_REDRIVE_INTERVAL_MS = 60 * 60_000`); intents `runPass` (outbox) | `src/eventing/ops-system-migrations.pipeline.ts:63` |

### Pipeline `ops_usage_report` (aggregate `global`)

Declared at `src/eventing/ops-usage-report.pipeline.ts:25`.

| Kind            | Name          | Handles                                                                               | Declared at                                    |
| --------------- | ------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| process manager | `usageReport` | every 1 h (`USAGE_REPORT_WAKE_INTERVAL_MS = 60 * 60 * 1000`); intents `send` (outbox) | `src/eventing/ops-usage-report.pipeline.ts:30` |

### Tasks

Run by the tasks process, before serve.

| Task                      | Class                       | Declared at                                    |
| ------------------------- | --------------------------- | ---------------------------------------------- |
| `process-manager-purge`   | `ProcessManagerPurgeTask`   | `src/tasks/process-manager-purge.task.ts:135`  |
| `credentials-reseal`      | `CredentialsResealTask`     | `src/tasks/credentials-reseal.task.ts:257`     |
| `grant-platform-operator` | `GrantPlatformOperatorTask` | `src/tasks/grant-platform-operator.task.ts:13` |
| `system-migrations-pass`  | `SystemMigrationsPassTask`  | `src/tasks/system-migrations-pass.task.ts:15`  |

## Configuration

| Kind   | Leaf                             | Environment variable                | Declared at                        |
| ------ | -------------------------------- | ----------------------------------- | ---------------------------------- |
| secret | `licensePrivateKey`              | `LANGWATCH_LICENSE_PRIVATE_KEY`     | `src/app/ops.app.ts:735`           |
| secret | `slackBugReportsBotToken`        | `SLACK_BUG_REPORTS_BOT_TOKEN`       | `src/app/ops.app.ts:737`           |
| secret | `credentials`                    | `CREDENTIALS_SECRET`                | `src/app/ops.app.ts:739`           |
| secret | `credentialsFallback`            | `NEXTAUTH_SECRET`                   | `src/app/ops.app.ts:740`           |
| secret | `credentialsPrevious`            | `CREDENTIALS_SECRET_PREVIOUS`       | `src/app/ops.app.ts:741`           |
| config | `apiKey`                         | `LANGWATCH_OPS_API_KEY`             | `../contract/src/ops.config.ts:26` |
| config | `metricsApiKey`                  | `METRICS_API_KEY`                   | `../contract/src/ops.config.ts:28` |
| config | `clickhouseOpsUrl`               | `CLICKHOUSE_OPS_URL`                | `../contract/src/ops.config.ts:30` |
| config | `usageStats.disabled`            | `DISABLE_USAGE_STATS`               | `../contract/src/ops.config.ts:32` |
| config | `usageStats.installMethod`       | `INSTALL_METHOD`                    | `../contract/src/ops.config.ts:33` |
| config | `usageStats.chartVersion`        | `LANGWATCH_CHART_VERSION`           | `../contract/src/ops.config.ts:35` |
| config | `collectClickHouseBackupMetrics` | `CLICKHOUSE_BACKUP_METRICS_ENABLED` | `../contract/src/ops.config.ts:37` |
| config | `productAnalytics.key`           | `POSTHOG_KEY`                       | `../contract/src/ops.config.ts:44` |
| config | `productAnalytics.host`          | `POSTHOG_HOST`                      | `../contract/src/ops.config.ts:44` |
| config | `bugReportSlackChannel`          | `SLACK_BUG_REPORTS_CHANNEL`         | `../contract/src/ops.config.ts:46` |
| config | `cloudOps`                       | `LANGWATCH_CLOUD_OPS`               | `../contract/src/ops.config.ts:48` |
| config | `adminEmails`                    | `ADMIN_EMAILS`                      | `../contract/src/ops.config.ts:50` |
| config | `nodeEnvironment`                | `NODE_ENV`                          | `../contract/src/ops.config.ts:52` |
| config | `isSaas`                         | `IS_SAAS`                           | `../contract/src/ops.config.ts:53` |
| config | `publicBaseUrl`                  | `BASE_HOST`                         | `../contract/src/ops.config.ts:54` |
| config | `serviceVersion`                 | `SERVICE_VERSION`                   | `../contract/src/ops.config.ts:56` |
| config | `otelResourceAttributes`         | `OTEL_RESOURCE_ATTRIBUTES`          | `../contract/src/ops.config.ts:57` |

<!-- readme:generated:end -->
