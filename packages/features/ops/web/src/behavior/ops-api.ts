/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts` and
 * `governance-api.ts` say of their own maps: the procedures live in
 * `@langwatch/ops-server`, `@langwatch/enterprise-sso-server` and the process's
 * own composition, none of which a web package may import even for a type, and
 * the router type does not exist until a process instantiates it. Emitting this
 * file from the mounted router is the fix; writing it by hand is the interim,
 * and it is honest only because every payload below is the CONTRACT's wherever
 * the contract has one — which for Ops is nearly everywhere, because
 * `@langwatch/ops-contract` already carries the view types the transport
 * publishes.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `ops`, `bugReports` and `ssoConnections`
 * are mount points on the root router, and tRPC hashes that path into the React
 * Query cache key; spell one differently and these hooks quietly stop sharing a
 * cache with the `api.ops.*` call sites that have not moved — the navigation
 * badge, which still polls `ops.getBadgeCounts` from `platform/app`, is exactly
 * such a call site.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. It buys a content-faithful move:
 * every `api.ops.x.useQuery(...)` call site in the fourteen screens is the line
 * it was in `platform/app`. Recorded here so the finding it raises is a
 * decision rather than a surprise.
 *
 * WHAT IS DELIBERATELY ABSENT: `ops.dashboardStream`. It is a tRPC
 * SUBSCRIPTION, and `apps/ui`'s transport declares none — the host routes
 * subscriptions over a WebSocket it configures from its own environment, and a
 * feature that needs one is the signal to move that configuration rather than
 * guess at it. The dashboard already carried the fallback and now always takes
 * it: `ops.getDashboardSnapshot` on a five-second poll. Recorded in the
 * manifests as this move's one live-data loss.
 *
 * THREE RESTATED SHAPES, all for the same reason and each said where it is
 * declared: `OpsProjectionRegistration`, `OpsEventSubscriberRegistration` and
 * `BackofficeSsoConnection` are published by transports rather than by a
 * contract, so there is no package a browser may import them from.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";
import type {
  AggregateDiscovery,
  AggregateEventView,
  AggregateProcessManager,
  AggregateSearchResult,
  Anomaly,
  BlobSweepReport,
  DashboardData,
  DeadLetterCount,
  DeadOutboxMessageView,
  DeleteBlobResult,
  GroupInfo,
  OpsBlobPage,
  OpsBlobSort,
  OpsBlobStoreStats,
  OpsBlobSummary,
  OpsBlockedSummary,
  OpsMigrationCohortResult,
  OpsMigrationEnrollmentListing,
  OpsMigrationOrganizationMatch,
  OpsMigrationOverview,
  OpsMigrationTargetedRunResult,
  OpsParkedGroupsPage,
  OpsQueueDlqGroup,
  OpsQueueDlqGroupWithQueue,
  OpsQueueDrainPreview,
  OpsQueueGroupsPage,
  OpsQueueJobsPage,
  OpsScheduledJob,
  OutboxAttemptView,
  ProcessAuditEntryView,
  ProcessFleetSummary,
  ProcessInstanceDetail,
  ProcessInstanceRow,
  ProcessOutboxMessageView,
  ProcessWakeRow,
  ProjectionStateAtEvent,
  QueueSummaryInfo,
  ReplayHistoryEntry,
  ReplayStatus,
  SchedulerAuditEntryView,
} from "@langwatch/ops-contract";
import type {
  FeatureFlagRules,
  OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";

/** An acknowledgement, for the writes whose only answer is that they happened. */
export type OpsAcknowledgement = { ok: boolean };

/**
 * One registered projection, as the process's pipeline registry publishes it.
 *
 * Restated from `@langwatch/ops-server`'s `OpsProjectionRegistration`, which is
 * a transport type rather than a contract one: the registry is the process's
 * own composition, and there is no package a browser may name it from.
 */
export type OpsProjectionRegistration = Readonly<{
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
  kind: "fold" | "map" | "state";
}>;

/** One registered event subscriber, and the event types it reacts to. */
export type OpsEventSubscriberRegistration = Readonly<{
  subscriberName: string;
  pipelineName: string;
  aggregateType: string;
  eventTypes: readonly string[];
}>;

/** The bound on an event-log search, as the Deja View banner states it. */
export type OpsEventLogSearchWindow = {
  searchLookbackDays: number;
  hotTierDays: number | null;
  hotTierEnvVar: string | null;
};

/** The Grafana deep-link configuration, or null when no Grafana is configured. */
export type OpsGrafanaLinkConfig = {
  baseUrl: string;
  tempoDatasourceUid?: string | undefined;
  lokiDatasourceUid?: string | undefined;
} | null;

/** One project the tenant picker matched. */
export type OpsProjectMatch = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  organizationName: string;
};

/** One report in the issue inbox's listing. */
export type BugReportListingRow = {
  id: string;
  createdAt: string | Date;
  source: string;
  kind: string;
  title: string;
  agent: string | null;
  linkedProjectId: string | null;
  contactEmail: string | null;
};

/** One report opened in full, transcript included. */
export type BugReportDetail = BugReportListingRow & {
  summary: string | null;
  cliVersion: string | null;
  sessionData: string | null;
  sessionTruncated: boolean;
};

/**
 * One SSO connection as the back office reads it.
 *
 * Restated from `@langwatch/enterprise-sso-server`'s `BackofficeSsoConnection`
 * for the same reason as the two registrations above, and with the extra one
 * that a core web package may not name an enterprise package at all.
 */
export type BackofficeSsoConnection = Readonly<{
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  type: string;
  state: string;
  claimedDomains: string[];
  approvedDomains: string[];
  verifiedDomains: string[];
  domainVerifications: {
    domain: string;
    method: string;
    actorId: string | null;
    verifiedAtMs: number;
  }[];
  providerId: string;
  issuer: string | null;
  allowsJit: boolean;
  source: string;
  testLoginAccountId: string | null;
  rejection: { domain: string; note: string } | null;
  pendingVerificationDomain: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

/**
 * One organization, as the Foundry's project picker reads the graph.
 *
 * The same `organization.getAll` the application shell asks for, and the same
 * cache entry under tRPC's path-plus-input key — the graph is fetched once for
 * the document however many halves of the product want it. Only the fields the
 * picker prints are named: it is a view of the wire, not the whole of it, and
 * `apiKey` is on it because a generated trace is sent with the project's own
 * key.
 */
export type OpsOrganizationGraph = {
  id: string;
  name: string;
  slug: string;
  teams: {
    id: string;
    name: string;
    slug: string;
    projects: { id: string; name: string; slug: string; apiKey: string }[];
  }[];
};

/** One prompt, as the Foundry's generator references it on a span. */
export type OpsPromptSummary = {
  id: string;
  version: number;
  versionId: string;
  handle: string | null;
  model?: string | null;
  inputs?: Array<{ identifier: string; type: string }> | null;
};

/** The whole `ops.*`, `bugReports.*`, `ssoConnections.*`, `organization.*` and `prompts.*`
 * surface this package calls. */
export type OpsApiMap = {
  ops: {
    getDashboardSnapshot: { query: { input: void; output: DashboardData | null } };
    listParkedGroups: {
      query: {
        input: { queueName: string; tenantId: string; page: number; pageSize: number };
        output: OpsParkedGroupsPage;
      };
    };
    listQueues: { query: { input: void; output: QueueSummaryInfo[] } };

    // -- Scheduler -----------------------------------------------------------
    listScheduledJobs: { query: { input: { limit: number }; output: OpsScheduledJob[] } };
    listPausedSchedules: {
      query: {
        input: { limit: number };
        output: { schedules: OpsScheduledJob[]; total: number };
      };
    };
    listSchedulerActions: {
      query: { input: { limit: number }; output: SchedulerAuditEntryView[] };
    };
    setScheduleActive: {
      mutation: { input: { scheduleId: string; active: boolean }; output: OpsScheduledJob };
    };
    clearScheduleSlot: { mutation: { input: { scheduleId: string }; output: OpsScheduledJob } };
    runScheduleNow: { mutation: { input: { scheduleId: string }; output: OpsScheduledJob } };

    // -- Group queue ---------------------------------------------------------
    listGroups: {
      query: {
        input: { queueName: string; page: number; pageSize: number };
        output: OpsQueueGroupsPage;
      };
    };
    getGroupDetail: {
      query: { input: { queueName: string; groupId: string }; output: GroupInfo };
    };
    getGrafanaLinkConfig: { query: { input: void; output: OpsGrafanaLinkConfig } };
    getBlockedSummary: { query: { input: void; output: OpsBlockedSummary } };
    getGroupJobs: {
      query: {
        input: { queueName: string; groupId: string; page: number; pageSize: number };
        output: OpsQueueJobsPage;
      };
    };
    unblockGroup: {
      mutation: { input: { queueName: string; groupId: string }; output: { wasBlocked: boolean } };
    };
    unblockAll: {
      mutation: { input: { queueName: string }; output: { unblockedCount: number } };
    };
    drainGroup: {
      mutation: { input: { queueName: string; groupId: string }; output: { jobsRemoved: number } };
    };
    pausePipeline: { mutation: { input: { queueName: string; key: string }; output: void } };
    unpausePipeline: { mutation: { input: { queueName: string; key: string }; output: void } };
    pauseTenant: { mutation: { input: { queueName: string; tenantId: string }; output: void } };
    unpauseTenant: { mutation: { input: { queueName: string; tenantId: string }; output: void } };
    listPausedTenants: { query: { input: { queueName: string }; output: string[] } };
    drainTenant: {
      mutation: {
        input: { queueName: string; tenantId: string; groupIdContains?: string };
        output: { groupsDrained: number; jobsDrained: number };
      };
    };
    listAllDlqGroups: { query: { input: void; output: OpsQueueDlqGroupWithQueue[] } };
    listDlqGroups: { query: { input: { queueName: string }; output: OpsQueueDlqGroup[] } };
    drainAllBlockedPreview: {
      query: {
        input: { queueName: string; pipelineFilter?: string; errorFilter?: string };
        output: OpsQueueDrainPreview;
      };
    };
    moveToDlq: {
      mutation: { input: { queueName: string; groupId: string }; output: { jobsMoved: number } };
    };
    moveAllBlockedToDlq: {
      mutation: {
        input: { queueName: string; pipelineFilter?: string; errorFilter?: string };
        output: { movedCount: number; jobsMoved: number };
      };
    };
    redriveManyFromDlq: {
      mutation: {
        input: { queueName: string; groupIds: string[] };
        output: { redrivenCount: number; jobsRedriven: number };
      };
    };
    discardManyFromDlq: {
      mutation: {
        input: { queueName: string; groupIds: string[] };
        output: { discardedCount: number; jobsDiscarded: number };
      };
    };
    canaryRedrive: {
      mutation: {
        input: { queueName: string; count?: number; pipelineFilter?: string };
        output: { redrivenCount: number; groupIds: string[] };
      };
    };
    canaryUnblock: {
      mutation: {
        input: { queueName: string; count?: number; pipelineFilter?: string };
        output: { unblockedCount: number; groupIds: string[] };
      };
    };

    // -- Projections and event subscribers -----------------------------------
    listProjections: {
      query: {
        input: void;
        output: {
          projections: OpsProjectionRegistration[];
          eventSubscribers: OpsEventSubscriberRegistration[];
        };
      };
    };

    // -- Process-manager fleet -----------------------------------------------
    getAggregateProcessManagers: {
      query: {
        input: { aggregateType: string; tenantId: string; aggregateId: string };
        output: AggregateProcessManager[];
      };
    };
    listProcessFleet: { query: { input: void; output: ProcessFleetSummary[] } };
    listDeadLetters: {
      query: {
        input: { processName?: string; page: number; pageSize: number };
        output: {
          messages: DeadOutboxMessageView[];
          total: number;
          byProcess: DeadLetterCount[];
        };
      };
    };
    listDeadLetterCounts: { query: { input: void; output: DeadLetterCount[] } };
    listProcessInstances: {
      query: {
        input: { processName?: string; page: number; pageSize: number; search?: string };
        output: { instances: ProcessInstanceRow[]; total: number };
      };
    };
    listUpcomingWakes: { query: { input: { limit: number }; output: ProcessWakeRow[] } };
    getProcessInstance: {
      query: {
        input: { processName: string; projectId: string; processKey: string };
        output: ProcessInstanceDetail | null;
      };
    };
    listProcessOutbox: {
      query: {
        input: {
          processName: string;
          projectId: string;
          processKey: string;
          page: number;
          pageSize: number;
        };
        output: { messages: ProcessOutboxMessageView[]; total: number };
      };
    };
    listProcessActions: { query: { input: { limit: number }; output: ProcessAuditEntryView[] } };
    listOutboxAttempts: {
      query: { input: { outboxId: string; projectId: string }; output: OutboxAttemptView[] };
    };
    processWakeNow: {
      mutation: {
        input: { processName: string; projectId: string; processKey: string };
        output: { woke: boolean };
      };
    };
    processRedriveDeadInstance: {
      mutation: {
        input: { processName: string; projectId: string; processKey: string };
        output: { requeued: number };
      };
    };
    processRedriveDeadMessage: {
      mutation: {
        input: { processName: string; projectId: string; processKey: string; messageId: string };
        output: { redriven: boolean };
      };
    };
    processDiscardDeadMessage: {
      mutation: {
        input: { processName: string; projectId: string; processKey: string; messageId: string };
        output: { discarded: boolean };
      };
    };
    processReleaseLapsedLease: {
      mutation: {
        input: { processName: string; projectId: string; processKey: string; messageId: string };
        output: { released: boolean };
      };
    };
    redriveDeadLetters: {
      mutation: { input: { processName?: string }; output: { redriven: number } };
    };
    discardDeadLetters: {
      mutation: {
        /** The fleet-wide form — no `processName` — takes a typed confirmation. */
        input: { processName?: string; confirm?: string };
        output: { discarded: number };
      };
    };

    // -- Event log, replay and Deja View -------------------------------------
    discoverAggregates: {
      query: {
        input: { projectionNames: string[]; since: string; tenantIds?: string[] };
        output: AggregateDiscovery;
      };
    };
    searchTenants: { query: { input: { query: string }; output: OpsProjectMatch[] } };
    searchAggregates: {
      query: {
        input: { query: string; tenantId?: string; sinceMs?: number };
        output: AggregateSearchResult[];
      };
    };
    getEventLogSearchWindow: { query: { input: void; output: OpsEventLogSearchWindow } };
    loadAggregateEvents: {
      query: {
        input: { aggregateId: string; tenantId: string; limit?: number };
        output: AggregateEventView[];
      };
    };
    computeProjectionState: {
      query: {
        input: {
          aggregateId: string;
          tenantId: string;
          projectionName: string;
          eventIndex: number;
        };
        output: ProjectionStateAtEvent;
      };
    };
    dryRunReplay: {
      mutation: {
        input: {
          projectionNames: string[];
          since: string;
          tenantIds: string[];
          sampleSize?: number;
        };
        output: {
          status: string;
          message: string;
          projectionNames: string[];
          sampleSize: number;
        };
      };
    };
    getReplayHistory: { query: { input: void; output: ReplayHistoryEntry[] } };
    getReplayRun: { query: { input: { runId: string }; output: ReplayHistoryEntry | null } };
    startReplay: {
      mutation: {
        input: {
          projectionNames: string[];
          since: string;
          tenantIds?: string[];
          aggregateIds?: string[];
          fullRebuild?: boolean;
          description: string;
        };
        output: { runId: string };
      };
    };
    getReplayStatus: { query: { input: void; output: ReplayStatus } };
    cancelReplay: { mutation: { input: void; output: { cancelled: boolean } } };

    // -- Tenant anomalies ----------------------------------------------------
    listAnomalies: { query: { input: void; output: { anomalies: Anomaly[] } } };
    dismissAnomaly: {
      mutation: {
        input: { tenantId: string; kind: Anomaly["kind"] };
        output: { dismissed: boolean };
      };
    };

    // -- Feature flags -------------------------------------------------------
    listFeatureFlags: { query: { input: void; output: OperatorFeatureFlagCatalogue } };
    setFeatureFlag: {
      mutation: { input: { key: string; enabled: boolean }; output: OpsAcknowledgement };
    };
    setFeatureFlagRules: {
      mutation: { input: { key: string; rules: FeatureFlagRules }; output: OpsAcknowledgement };
    };
    clearFeatureFlag: { mutation: { input: { key: string }; output: OpsAcknowledgement } };

    // -- Payload store -------------------------------------------------------
    listBlobQueues: { query: { input: void; output: string[] } };
    getBlobStoreStats: { query: { input: void; output: OpsBlobStoreStats } };
    listBlobs: {
      query: {
        input: {
          queueName: string;
          cursor?: string | null;
          limit?: number;
          projectId?: string | null;
          sort?: OpsBlobSort;
        };
        output: OpsBlobPage;
      };
    };
    getBlob: {
      query: {
        input: { queueName: string; projectId: string; hash: string };
        output: OpsBlobSummary | null;
      };
    };
    runBlobCleanup: {
      mutation: {
        input: { dryRun?: boolean; confirm?: "RECLAIM" };
        output: BlobSweepReport;
      };
    };
    deleteBlob: {
      mutation: {
        input: { queueName: string; projectId: string; hash: string; confirm: "DELETE" };
        output: DeleteBlobResult;
      };
    };

    // -- In-place system migrations ------------------------------------------
    listSystemMigrations: { query: { input: void; output: OpsMigrationOverview[] } };
    listMigrationEnrollments: {
      query: { input: void; output: OpsMigrationEnrollmentListing };
    };
    searchMigrationOrganizations: {
      query: { input: { query: string }; output: OpsMigrationOrganizationMatch[] };
    };
    enrollMigrationTenant: {
      mutation: {
        input: { organizationId: string; migrationName: string; confirm?: string };
        output: { enrolled: boolean };
      };
    };
    enrollMigrationCohort: {
      mutation: {
        input: {
          migrationName: string;
          sampleSize: number;
          includeEnterprise?: boolean;
          includePrivateDataplane?: boolean;
          confirm?: string;
        };
        output: OpsMigrationCohortResult;
      };
    };
    withdrawMigrationTenant: {
      mutation: {
        input: { organizationId: string; migrationName: string };
        output: { withdrawn: boolean };
      };
    };
    runSystemMigrationForOrganization: {
      mutation: {
        input: { organizationId: string; migrationName: string; confirm?: string };
        output: OpsMigrationTargetedRunResult;
      };
    };
    runSystemMigrationPass: { mutation: { input: void; output: { started: boolean } } };
    rollBackSystemMigrationTenant: {
      mutation: {
        input: { migrationName: string; tenantId: string; confirm?: string };
        output: { rolledBack: boolean };
      };
    };
  };

  bugReports: {
    getAll: {
      query: {
        input: { page: number; pageSize: number; search?: string };
        output: { reports: BugReportListingRow[]; total: number };
      };
    };
    getById: { query: { input: { id: string }; output: BugReportDetail } };
  };

  organization: {
    getAll: {
      query: { input: { isDemo: boolean }; output: OpsOrganizationGraph[] };
    };
  };

  prompts: {
    getAllPromptsForProject: {
      query: { input: { projectId: string }; output: OpsPromptSummary[] };
    };
  };

  ssoConnections: {
    getAll: {
      query: {
        input: { page: number; pageSize: number; search?: string };
        output: { connections: BackofficeSsoConnection[]; total: number };
      };
    };
    getById: {
      query: { input: { connectionId: string }; output: BackofficeSsoConnection | null };
    };
    approveDomainClaim: {
      mutation: {
        input: { organizationId: string; connectionId: string; domain: string };
        output: void;
      };
    };
    rejectDomainClaim: {
      mutation: {
        input: { organizationId: string; connectionId: string; domain: string; note: string };
        output: void;
      };
    };
    attestDomain: {
      mutation: {
        input: { organizationId: string; connectionId: string; domain: string };
        output: void;
      };
    };
    activate: {
      mutation: {
        input: { organizationId: string; connectionId: string; testLoginAccountId: string };
        output: void;
      };
    };
    suspend: {
      mutation: {
        input: { organizationId: string; connectionId: string; reason: string | null };
        output: void;
      };
    };
    resume: {
      mutation: { input: { organizationId: string; connectionId: string }; output: void };
    };
    requestTeardown: {
      mutation: {
        input: { organizationId: string; connectionId: string; reason: string | null };
        output: void;
      };
    };
  };
};

/**
 * The hooks every Ops screen calls.
 *
 * One instance for the package. `@trpc/react-query` keys its React Query
 * entries on the procedure PATH alone, so this instance and the application's
 * own `api` proxy share cache entries given the same QueryClient — which is
 * what keeps the navigation badge's `ops.getBadgeCounts` and this package's
 * `ops.listDeadLetterCounts` reading one another's invalidations while the two
 * halves are split across packages.
 */
export const opsApi = createFeatureApi<OpsApiMap>();

/**
 * Every procedure's output, addressed the way the screens already address it.
 *
 * The application's `~/utils/api` exported `RouterOutputs` off the real
 * `AppRouter`; deriving the same shape from the map above keeps those aliases
 * exactly as they were written.
 */
type OpsOutputOf<TNode> = TNode extends { query: { output: infer TOutput } }
  ? TOutput
  : TNode extends { mutation: { output: infer TOutput } }
    ? TOutput
    : { [TSegment in keyof TNode]: OpsOutputOf<TNode[TSegment]> };

export type RouterOutputs = {
  [TSegment in keyof OpsApiMap]: OpsOutputOf<OpsApiMap[TSegment]>;
};

/**
 * The name the screens call it by.
 *
 * They were written against the application's `api` proxy and are moved
 * unchanged; the import line is what tells them which one they have.
 */
export const api = opsApi;
