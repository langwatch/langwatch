/**
 * The operator back office over the process's tRPC transport.
 *
 * Every procedure here is a privilege boundary. The surface is platform-tier:
 * it reads and acts across every tenant, so the gate is not an RBAC permission
 * resolved against an id in the input but the operator scope the process
 * resolves from its admin allow-list. `ops:view` reads, `ops:manage` writes,
 * and the writes whose damage nobody would notice in time additionally require
 * a non-impersonated session and a typed confirmation.
 *
 * Grouped roughly as the dashboard is: the scope probe and dashboard, the group
 * queue, the scheduler, the process-manager fleet, event replay, tenant
 * anomalies, feature flags, the blob store, and the in-place system migrations.
 *
 * Transport only: gates, input shapes and delegation. Every process capability
 * this surface needs that is not the operations service's own — the pipeline
 * registry, the event-log tier window, the Grafana deep-link configuration and
 * the system-migrations runner — arrives as a port.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import {
  aggregateProcessManagerSchema,
  blobSweepReportSchema,
  dashboardDataSchema,
  deadLetterCountSchema,
  deleteBlobOperatorInputSchema,
  deleteBlobResultSchema,
  groupInfoSchema,
  getBlobInputSchema,
  listBlobsInputSchema,
  opsAggregateProcessManagersInputSchema,
  opsAnomalyDismissedSchema,
  opsAnomalyListingSchema,
  opsApiGetBadgeCountsOutputSchema,
  opsAggregateDiscoverySchema,
  opsAggregateEventsSchema,
  opsAggregateSearchSchema,
  opsAssertLegacyWritersDrainedInputSchema,
  opsBlobPageSchema,
  opsBlobStoreStatsSchema,
  opsBlobSummarySchema,
  opsBlockedSummarySchema,
  opsComputeProjectionStateInputSchema,
  opsDeadLetterPageSchema,
  opsDiscardDeadLettersInputSchema,
  opsDiscoverAggregatesInputSchema,
  opsDismissAnomalyInputSchema,
  opsDrainQueueTenantInputSchema,
  opsDryRunReplaySchema,
  opsDryRunReplayInputSchema,
  opsEnrollMigrationCohortInputSchema,
  opsEnrollMigrationTenantInputSchema,
  opsEventLogSearchWindowSchema,
  opsFeatureFlagKeyInputSchema,
  opsGetReplayRunInputSchema,
  opsListDeadLettersInputSchema,
  opsListOutboxAttemptsInputSchema,
  opsListParkedQueueGroupsInputSchema,
  opsListPausedSchedulesInputSchema,
  opsParkedGroupsPageSchema,
  opsListProcessActionsInputSchema,
  opsListProcessInstancesInputSchema,
  opsListProcessOutboxInputSchema,
  opsListQueueGroupJobsInputSchema,
  opsListQueueGroupsInputSchema,
  opsListScheduledJobsInputSchema,
  opsListSchedulerActionsInputSchema,
  opsGrafanaLinkConfigSchema,
  opsListUpcomingWakesInputSchema,
  opsLoadAggregateEventsInputSchema,
  opsMigrationCohortResultSchema,
  opsMigrationDrainAssertedSchema,
  opsMigrationEnrolledSchema,
  opsMigrationEnrollmentListingSchema,
  opsMigrationOrganizationMatchSchema,
  opsMigrationOverviewSchema,
  opsMigrationPassStartedSchema,
  opsMigrationRolledBackSchema,
  opsMigrationTargetedRunResultSchema,
  opsMigrationTenantInputSchema,
  opsMigrationWithdrawnSchema,
  opsOkOutputSchema,
  opsPausedSchedulesPageSchema,
  opsPipelineRegistrationsSchema,
  opsProcessDiscardedDeadLettersSchema,
  opsProcessDiscardedMessageSchema,
  opsProcessInstancePageSchema,
  opsProcessMessageInputSchema,
  opsProcessOutboxPageSchema,
  opsProcessRedrivenDeadLettersSchema,
  opsProcessRedrivenMessageSchema,
  opsProcessRefInputSchema,
  opsProcessReleasedLeaseSchema,
  opsProcessRequeuedSchema,
  opsProcessWokeSchema,
  opsProjectionStateSchema,
  opsQueueCanaryInputSchema,
  opsQueueCanaryRedrivenSchema,
  opsQueueCanaryUnblockedSchema,
  opsQueueFilterInputSchema,
  opsQueueDiscardedDlqGroupsSchema,
  opsQueueDlqGroupSchema,
  opsQueueDlqGroupWithQueueSchema,
  opsQueueDrainedGroupSchema,
  opsQueueDrainedTenantSchema,
  opsQueueDrainPreviewSchema,
  opsQueueGroupIdsInputSchema,
  opsQueueGroupInputSchema,
  opsQueueGroupsPageSchema,
  opsQueueJobsPageSchema,
  opsQueueMovedAllToDlqSchema,
  opsQueueMovedToDlqSchema,
  opsQueueNameInputSchema,
  opsQueueNameListSchema,
  opsQueuePipelineInputSchema,
  opsQueueTenantInputSchema,
  opsRedriveDeadLettersInputSchema,
  opsQueueRedrivenDlqGroupsSchema,
  opsQueueReplayedAllFromDlqSchema,
  opsQueueReplayedFromDlqSchema,
  opsRequeueDeadOutboxMessagesInputSchema,
  opsRetryBlockedQueueJobInputSchema,
  opsQueueUnblockedAllSchema,
  opsQueueUnblockedGroupSchema,
  opsReplayCancelledSchema,
  opsReplayStartedSchema,
  opsRollBackSystemMigrationTenantInputSchema,
  opsRunSystemMigrationForOrganizationInputSchema,
  opsScheduleIdInputSchema,
  opsScheduledJobSchema,
  opsScopeProbeSchema,
  opsSearchAggregatesInputSchema,
  type OpsEventSubscriberRegistration,
  type OpsMigrationCohortResult,
  type OpsMigrationEnrollmentListing,
  type OpsMigrationOrganizationMatch,
  type OpsMigrationOverview,
  type OpsMigrationTargetedRunResult,
  type OpsProjectionRegistration,
  type OpsScope,
  opsSearchMigrationOrganizationsInputSchema,
  opsSearchTenantsInputSchema,
  opsTenantSearchSchema,
  opsSetFeatureFlagInputSchema,
  opsSetScheduleActiveInputSchema,
  opsStartReplayInputSchema,
  outboxAttemptViewSchema,
  processAuditEntryViewSchema,
  processFleetSummarySchema,
  processInstanceDetailSchema,
  processWakeRowSchema,
  queueSummaryInfoSchema,
  replayHistoryEntrySchema,
  replayStatusSchema,
  runBlobCleanupOperatorInputSchema,
  schedulerAuditEntryViewSchema,
} from "@langwatch/ops-contract";
import {
  featureFlagRulesWriteSchema,
  operatorFeatureFlagCatalogueSchema,
} from "@langwatch/feature-flag-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { OpsApp, OpsOperator } from "#app/ops.app";
import { nowInstant } from "@langwatch/time";

/**
 * The process supplies authentication and the resolved operator scope.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. A REST door, whose service
 * is built per family, would hold {@link OpsApp} directly.
 */
export type OpsTrpcContext = Readonly<{
  app: Readonly<{ ops: OpsApp }>;
  actor(): Readonly<{ id: string }>;
  /** Populated by the process's operator middleware; absent means it never ran. */
  opsScope: OpsScope | undefined;
  session: Readonly<{ user: OpsOperator }> | null;
}>;

type OpsTrpcProcedures<
  TContext extends OpsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, operator and audit
   * policy for one operator permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it: tRPC runs middlewares in the order they were added, and the
   * lineage guard and the audit row both read the validated input. The operator
   * check itself resolves the admin allow-list and reads no id at all, which is
   * why this surface is platform-tier.
   */
  policy(permission: "ops:view" | "ops:manage"): <TProcedure>(procedure: TProcedure) => TProcedure;
  /**
   * The status-probe variant of the `ops:view` policy: it populates the scope
   * and answers `{ kind: "none" }` for a non-operator rather than refusing, so
   * the global menu can poll it on every page load.
   */
  probePolicy: TrpcPolicyDecorator;
  /**
   * @see the mount field of the same name. Optional because the process's
   * mount predates it and leaves output validation off in production.
   */
  validateOutput?: boolean;
}>;

/** The process capabilities this transport needs that are not operations' own. */
export type OpsTrpcPorts = Readonly<{
  /** The registered projections and event subscribers. */
  listPipelineRegistrations(): {
    projections: OpsProjectionRegistration[];
    eventSubscribers: OpsEventSubscriberRegistration[];
  };
  /**
   * The bound on an event-log search: the default lookback the explorer uses
   * and the env-derived hot-tier window, so the surface can say up front where
   * reads get slower.
   */
  getEventLogSearchWindow(): {
    searchLookbackDays: number;
    hotTierDays: number | null;
    hotTierEnvVar: string | null;
  };
  /** Grafana deep-link configuration, or null when no Grafana is configured. */
  tryGetGrafanaLinkConfig(): {
    baseUrl: string;
    tempoDatasourceUid?: string | undefined;
    lokiDatasourceUid?: string | undefined;
  } | null;
  /** The in-place system-migrations runner and its read model. */
  systemMigrations: {
    // Named types, not `unknown`. A tRPC procedure publishes what its handler
    // returns, so an `unknown` here is what the browser gets: the migrations
    // page was reading `data?.isSaaS` off `{}` and every row field off
    // `unknown`. The process's service has always answered these shapes.
    getOverview(): Promise<OpsMigrationOverview[]>;
    getEnrollments(input: { requestedBy: string }): Promise<OpsMigrationEnrollmentListing>;
    searchOrganizations(input: { query: string }): Promise<OpsMigrationOrganizationMatch[]>;
    requiresOperatorConfirmation(input: { migrationName: string }): boolean;
    enroll(input: {
      organizationId: string;
      migrationName: string;
      actorUserId: string;
    }): Promise<void>;
    enrollCohort(input: {
      migrationName: string;
      sampleSize: number;
      actorUserId: string;
      includeEnterprise: boolean;
      includePrivateDataplane: boolean;
    }): Promise<OpsMigrationCohortResult>;
    withdraw(input: {
      organizationId: string;
      migrationName: string;
      actorUserId: string;
    }): Promise<void>;
    runForOrganization(input: {
      organizationId: string;
      migrationName: string;
      actorUserId: string;
    }): Promise<OpsMigrationTargetedRunResult>;
    startPass(): void;
    assertLegacyWritersDrained(input: {
      migrationName: string;
      tenantId: string;
      minimumWriterGeneration: string;
      actorUserId: string;
    }): Promise<unknown>;
    rollBack(input: {
      migrationName: string;
      tenantId: string;
      actorUserId: string;
    }): Promise<unknown>;
  };
}>;

/**
 * The extra gate on an ops write whose damage nobody will notice in time,
 * applied to the operator the process authenticated.
 *
 * The rule itself is {@link OpsApp.requireDestructiveOperator}; this is only
 * the transport reading its caller. A confirmation dialog in the ops UI is not
 * the guard — every one of these procedures is callable directly.
 */
function requireDestructiveOpsAuth(ctx: OpsTrpcContext, confirm: string | undefined): void {
  ctx.app.ops.requireDestructiveOperator(ctx.session?.user ?? null, confirm);
}

/** Installs the complete `ops.*` tRPC surface on a process-owned root. */
export class OpsTrpcApi {
  static create<
    TContext extends OpsTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPorts extends OpsTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: OpsTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy, probePolicy } = procedures;
    const validateOutput = procedures.validateOutput ?? false;

    const dashboard = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * Status probe — returns the calling user's ops scope. Always succeeds for
       * any authenticated user; non-ops users get `{ scope: { kind: "none" } }`
       * instead of FORBIDDEN. The hook (`useOpsPermission`) derives `hasAccess`
       * from `scope.kind !== "none"` so the global menu can hide ops UI without
       * spamming the console with permission errors on every page load
       * (lw#3584).
       *
       * The mutating ops endpoints below still go through the throw-on-deny
       * variant of the operator check — only this status probe relaxes it.
       */
      .query("getScope", (p) =>
        p
          .withoutInput("the probe reads the caller's own resolved scope, nothing else")
          .withOutput(opsScopeProbeSchema)
          .withCustomPermission(
            probePolicy,
            "the ops:view check in its answer-rather-than-refuse variant, so the global menu can poll it",
          )
          .handle(({ ctx }) => {
            // A plain Error on purpose: the scope missing means the process's
            // operator middleware never ran, which is a wiring fault with no
            // action for the caller. It degrades to the generic unknown failure
            // plus a trace id, which is the honest answer, and keeps the
            // INTERNAL_SERVER_ERROR this always returned.
            if (!ctx.opsScope) {
              throw new Error("opsScope not populated by middleware (probable bug)");
            }
            return { scope: ctx.opsScope };
          }),
      )
      .query("getDashboardSnapshot", (p) =>
        p
          .withoutInput("the dashboard is the whole fleet; there is nothing to narrow it by")
          .withOutput(dashboardDataSchema.nullable())
          .withPermission("ops:view")
          .handle(({ ctx }) => ctx.app.ops.tryGetDashboardData()),
      )
      /**
       * Cheap counts-only query for the global ops badge in the main menu.
       * Returns just the two integers the badge renders (blocked groups +
       * DLQ jobs), bypassing the full dashboard aggregation. Use this for
       * always-on polling; reach for `getDashboardSnapshot` only on the
       * ops route itself.
       */
      .query("getBadgeCounts", (p) =>
        p
          .withoutInput("one fleet-wide reading; the badge has nothing to scope it to")
          .withOutput(opsApiGetBadgeCountsOutputSchema)
          .withPermission("ops:view")
          .handle(({ ctx }) => ctx.app.ops.badgeCounts()),
      )
      .subscription("dashboardStream", (p) =>
        p
          .withoutInput("the stream carries the same fleet-wide dashboard the snapshot does")
          .withOutput(dashboardDataSchema)
          .withPermission("ops:view")
          .handle(async function* ({ signal, ctx }) {
            yield* ctx.app.ops.streamDashboard({ signal });
          }),
      )
      /**
       * One parked tenant's groups, read live rather than from the snapshot.
       *
       * A parking storm can hold hundreds of thousands of groups; carrying those
       * in a snapshot every pod reads would recreate the size problem ADR-090
       * removes. The tenant ROWS ship in the snapshot, their members do not.
       */
      .query("listParkedGroups", (p) =>
        p
          .withInput(opsListParkedQueueGroupsInputSchema)
          .withOutput(opsParkedGroupsPageSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.listParkedQueueGroups(input);
          }),
      )
      .query("listQueues", (p) =>
        p
          .withoutInput("every queue the process knows; there is nothing to filter by")
          .withOutput(queueSummaryInfoSchema.array())
          .withPermission("ops:view")
          .handle(async ({ ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.listQueues();
          }),
      )
      .build();

    const scheduler = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("listScheduledJobs", (p) =>
        p
          .withInput(opsListScheduledJobsInputSchema)
          .withOutput(opsScheduledJobSchema.array())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.operations.listScheduledJobs({ limit: input.limit }),
          ),
      )
      /**
       * Only the switched-off schedules, for the dashboard's "Switched off"
       * panel. Its own read because `listScheduledJobs` sorts active first, so a
       * client filtering that page would miss every paused row on a large fleet.
       */
      .query("listPausedSchedules", (p) =>
        p
          .withInput(opsListPausedSchedulesInputSchema)
          .withOutput(opsPausedSchedulesPageSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.operations.listPausedSchedules({ limit: input.limit }),
          ),
      )
      /** Recent scheduler operator actions, so the page explains its own history. */
      .query("listSchedulerActions", (p) =>
        p
          .withInput(opsListSchedulerActionsInputSchema)
          .withOutput(schedulerAuditEntryViewSchema.array())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.operations.listSchedulerActions({ limit: input.limit }),
          ),
      )
      /**
       * Pause or resume a schedule (ADR-091). Never touches an in-flight slot —
       * the confirmation copy says so, because a pause that silently killed a
       * live run would be a much larger promise than the one being made.
       */
      .mutation("setScheduleActive", (p) =>
        p
          .withInput(opsSetScheduleActiveInputSchema)
          .withOutput(opsScheduledJobSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.operations.setScheduleActive({
              scheduleId: input.scheduleId,
              active: input.active,
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      /** Release a slot whose worker stopped responding, so it can be claimed again. */
      .mutation("clearScheduleSlot", (p) =>
        p
          .withInput(opsScheduleIdInputSchema)
          .withOutput(opsScheduledJobSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.operations.clearStuckScheduleSlot({
              scheduleId: input.scheduleId,
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      /**
       * Make a schedule due immediately. The loop claims and runs it through the
       * ordinary path, so this inherits its exactly-once lease rather than
       * bypassing it.
       */
      .mutation("runScheduleNow", (p) =>
        p
          .withInput(opsScheduleIdInputSchema)
          .withOutput(opsScheduledJobSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.operations.runScheduleNow({
              scheduleId: input.scheduleId,
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      .build();

    const queues = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("listGroups", (p) =>
        p
          .withInput(opsListQueueGroupsInputSchema)
          .withOutput(opsQueueGroupsPageSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.listQueueGroups(input);
          }),
      )
      .query("getGroupDetail", (p) =>
        p
          .withInput(opsQueueGroupInputSchema)
          .withOutput(groupInfoSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.getQueueGroup(input)),
      )
      /**
       * The Grafana deep-link config, so ops surfaces can build per-row Explore
       * links client-side with pure builders. Null when no Grafana is
       * configured — callers render no link rather than a dead one. Gated like
       * every other ops read; Grafana itself is access-controlled, so the base
       * URL is not a secret to an operator.
       */
      .query("getGrafanaLinkConfig", (p) =>
        p
          .withoutInput("one deployment-wide configuration reading")
          .withOutput(opsGrafanaLinkConfigSchema)
          .withPermission("ops:view")
          .handle(() => ports.tryGetGrafanaLinkConfig()),
      )
      .query("getBlockedSummary", (p) =>
        p
          .withoutInput("the blocked set across every queue")
          .withOutput(opsBlockedSummarySchema)
          .withPermission("ops:view")
          .handle(async ({ ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.getBlockedQueueSummary();
          }),
      )
      .query("getGroupJobs", (p) =>
        p
          .withInput(opsListQueueGroupJobsInputSchema)
          .withOutput(opsQueueJobsPageSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.listQueueGroupJobs(input);
          }),
      )
      .mutation("unblockGroup", (p) =>
        p
          .withInput(opsQueueGroupInputSchema)
          .withOutput(opsQueueUnblockedGroupSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.unblockQueueGroup({
              ...input,
              requestedBy: ctx.actor().id,
            });
          }),
      )
      .mutation("unblockAll", (p) =>
        p
          .withInput(opsQueueNameInputSchema)
          .withOutput(opsQueueUnblockedAllSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.unblockAllQueueGroups({
              ...input,
              requestedBy: ctx.actor().id,
            });
          }),
      )
      .mutation("drainGroup", (p) =>
        p
          .withInput(opsQueueGroupInputSchema)
          .withOutput(opsQueueDrainedGroupSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.drainQueueGroup({
              ...input,
              requestedBy: ctx.actor().id,
            });
          }),
      )
      .mutation("pausePipeline", (p) =>
        p
          .withInput(opsQueuePipelineInputSchema)
          .withOutput(z.void())
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.pauseQueuePipeline(input);
          }),
      )
      .mutation("unpausePipeline", (p) =>
        p
          .withInput(opsQueuePipelineInputSchema)
          .withOutput(z.void())
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.unpauseQueuePipeline(input);
          }),
      )
      .mutation("pauseTenant", (p) =>
        p
          .withInput(opsQueueTenantInputSchema)
          .withOutput(z.void())
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.pauseQueueTenant(input);
          }),
      )
      .mutation("unpauseTenant", (p) =>
        p
          .withInput(opsQueueTenantInputSchema)
          .withOutput(z.void())
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.unpauseQueueTenant(input);
          }),
      )
      .query("listPausedTenants", (p) =>
        p
          .withInput(opsQueueNameInputSchema)
          .withOutput(opsQueueNameListSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.listPausedQueueTenants(input);
          }),
      )
      .mutation("drainTenant", (p) =>
        p
          .withInput(opsDrainQueueTenantInputSchema)
          .withOutput(opsQueueDrainedTenantSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.drainQueueTenant({
              ...input,
              requestedBy: ctx.actor().id,
            });
          }),
      )
      .mutation("retryBlocked", (p) =>
        p
          .withInput(opsRetryBlockedQueueJobInputSchema)
          .withOutput(opsQueueUnblockedGroupSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.retryBlockedQueueJob(input);
          }),
      )
      .query("listProjections", (p) =>
        p
          .withoutInput("the whole registry; a projection is not addressed by a scope")
          .withOutput(opsPipelineRegistrationsSchema)
          .withPermission("ops:view")
          .handle(() => ports.listPipelineRegistrations()),
      )
      .build();

    const processes = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * The per-aggregate process-manager state machines for one aggregate: each
       * machine's definition (triggers, intents, wake) joined to this aggregate's
       * current instance state and the intents it has emitted. Scheduled
       * singletons are excluded — they are not keyed by aggregate id.
       */
      .query("getAggregateProcessManagers", (p) =>
        p
          .withInput(opsAggregateProcessManagersInputSchema)
          .withOutput(aggregateProcessManagerSchema.array())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.processes.getForAggregate({
              aggregateType: input.aggregateType,
              projectId: input.tenantId,
              aggregateId: input.aggregateId,
            }),
          ),
      )
      /**
       * Dead-letter recovery: requeue one process instance's DEAD outbox rows
       * (optionally narrowed by message-key prefix) as pending, due now, with a
       * fresh attempt budget. The webhook platform's re-enable flow points here
       * for batches that exhausted the retry ladder.
       */
      .mutation("requeueDeadOutboxMessages", (p) =>
        p
          .withInput(opsRequeueDeadOutboxMessagesInputSchema)
          .withOutput(opsProcessRequeuedSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.ops.processes.requeueDeadMessages({
              processName: input.processName,
              projectId: input.tenantId,
              processKey: input.processKey,
              messageKeyPrefix: input.messageKeyPrefix,
              requestedBy: ctx.actor().id,
            }),
          ),
      )

      // ── Process-manager fleet (specs/ops/process-manager-visibility.feature) ──

      /** One row per process name: registry identity + live trouble counts. */
      .query("listProcessFleet", (p) =>
        p
          .withoutInput("every registered process manager")
          .withOutput(processFleetSummarySchema.array())
          .withPermission("ops:view")
          .handle(({ ctx }) => ctx.app.ops.processes.getFleetSummary()),
      )
      /**
       * Retired messages across every process. Answers "what has permanently
       * stopped", which `getProcessOutbox` could not: that one needs a full
       * process ref, so it can only be reached by an operator who already knows
       * where the failure is.
       */
      .query("listDeadLetters", (p) =>
        p
          .withInput(opsListDeadLettersInputSchema)
          .withOutput(opsDeadLetterPageSchema)
          .withPermission("ops:view")
          .handle(({ input, ctx }) => ctx.app.ops.processes.getDeadLetters(input)),
      )
      /** Dead totals per process, for the navigation badge and dashboard card. */
      .query("listDeadLetterCounts", (p) =>
        p
          .withoutInput("the fleet-wide totals; a per-process read is its own procedure")
          .withOutput(deadLetterCountSchema.array())
          .withPermission("ops:view")
          .handle(({ ctx }) => ctx.app.ops.processes.getDeadLetterCounts()),
      )
      .query("listProcessInstances", (p) =>
        p
          .withInput(opsListProcessInstancesInputSchema)
          .withOutput(opsProcessInstancePageSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.processes.getInstances(input)),
      )
      /** The soonest-due process wakes, for the dashboard's timed-work table. */
      .query("listUpcomingWakes", (p) =>
        p
          .withInput(opsListUpcomingWakesInputSchema)
          .withOutput(processWakeRowSchema.array())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.processes.getUpcomingWakes(input)),
      )
      .query("getProcessInstance", (p) =>
        p
          .withInput(opsProcessRefInputSchema)
          .withOutput(processInstanceDetailSchema.nullable())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.processes.tryGetInstanceDetail({ ref: input }),
          ),
      )
      .query("listProcessOutbox", (p) =>
        p
          .withInput(opsListProcessOutboxInputSchema)
          .withOutput(opsProcessOutboxPageSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const { page, pageSize, ...ref } = input;
            return ctx.app.ops.processes.getOutbox({ ref, page, pageSize });
          }),
      )
      .query("listProcessActions", (p) =>
        p
          .withInput(opsListProcessActionsInputSchema)
          .withOutput(processAuditEntryViewSchema.array())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.processes.listRecentActions(input)),
      )
      .mutation("processWakeNow", (p) =>
        p
          .withInput(opsProcessRefInputSchema)
          .withOutput(opsProcessWokeSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.ops.processes.wakeNow({
              ref: input,
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      .mutation("processRedriveDeadInstance", (p) =>
        p
          .withInput(opsProcessRefInputSchema)
          .withOutput(opsProcessRequeuedSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.ops.processes.redriveDeadInstance({
              ref: input,
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      .mutation("processRedriveDeadMessage", (p) =>
        p
          .withInput(opsProcessMessageInputSchema)
          .withOutput(opsProcessRedrivenMessageSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            const { messageId, ...ref } = input;
            return ctx.app.ops.processes.redriveDeadMessage({
              ref,
              messageId,
              actorUserId: ctx.actor().id,
            });
          }),
      )
      /** Mark one dead message never-to-be-sent — a mark, not a delete. */
      .mutation("processDiscardDeadMessage", (p) =>
        p
          .withInput(opsProcessMessageInputSchema)
          .withOutput(opsProcessDiscardedMessageSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            const { messageId, ...ref } = input;
            return ctx.app.ops.processes.discardDeadMessage({
              ref,
              messageId,
              actorUserId: ctx.actor().id,
            });
          }),
      )
      /**
       * Every dead letter back to pending — one process, or the fleet when
       * `processName` is omitted (specs/ops/dead-letter-recovery.feature).
       */
      .mutation("redriveDeadLetters", (p) =>
        p
          .withInput(opsRedriveDeadLettersInputSchema)
          .withOutput(opsProcessRedrivenDeadLettersSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.ops.processes.redriveDeadLetters({
              ...input,
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      /**
       * Every dead letter marked discarded; same scoping as the redrive.
       *
       * The fleet-wide form — no `processName` — crosses every tenant and cannot
       * be undone, since no redrive path selects a discarded row. It therefore
       * takes a typed confirmation, the same shape the blob-store delete uses:
       * the destructive breadth has to be reached deliberately, not by omitting
       * a field (best_practices/ops-dashboard.md).
       */
      .mutation("discardDeadLetters", (p) =>
        p
          .withInput(opsDiscardDeadLettersInputSchema)
          .withOutput(opsProcessDiscardedDeadLettersSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.ops.processes.discardDeadLetters({
              ...(input.processName ? { processName: input.processName } : {}),
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      /** The message's failed attempts, oldest first — why a dead letter died. */
      .query("listOutboxAttempts", (p) =>
        p
          .withInput(opsListOutboxAttemptsInputSchema)
          .withOutput(outboxAttemptViewSchema.array())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.processes.getOutboxAttempts(input)),
      )
      .mutation("processReleaseLapsedLease", (p) =>
        p
          .withInput(opsProcessMessageInputSchema)
          .withOutput(opsProcessReleasedLeaseSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            const { messageId, ...ref } = input;
            return ctx.app.ops.processes.releaseLapsedLease({
              ref,
              messageId,
              actorUserId: ctx.actor().id,
            });
          }),
      )
      .build();

    const replay = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("discoverAggregates", (p) =>
        p
          .withInput(opsDiscoverAggregatesInputSchema)
          .withOutput(opsAggregateDiscoverySchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.events.discoverAggregates({
              projectionNames: input.projectionNames,
              since: input.since,
              tenantIds: input.tenantIds ?? [],
            }),
          ),
      )
      .query("searchTenants", (p) =>
        p
          .withInput(opsSearchTenantsInputSchema)
          .withOutput(opsTenantSearchSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.searchProjects({ query: input.query })),
      )
      .mutation("dryRunReplay", (p) =>
        p
          .withInput(opsDryRunReplayInputSchema)
          .withOutput(opsDryRunReplaySchema)
          .withPermission("ops:manage")
          .handle(async ({ input }) => ({
            status: "coming_soon" as const,
            message: "Dry run is not yet implemented. Full replay will process all aggregates.",
            projectionNames: input.projectionNames,
            sampleSize: input.sampleSize,
          })),
      )
      .query("getReplayHistory", (p) =>
        p
          .withoutInput("every run this deployment has recorded")
          .withOutput(replayHistoryEntrySchema.array())
          .withPermission("ops:view")
          .handle(async ({ ctx }) => ctx.app.ops.replay.getHistory()),
      )
      .query("getReplayRun", (p) =>
        p
          .withInput(opsGetReplayRunInputSchema)
          .withOutput(replayHistoryEntrySchema.nullable())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) =>
            ctx.app.ops.replay.tryFindHistoryEntry({ runId: input.runId }),
          ),
      )
      .mutation("startReplay", (p) =>
        p
          .withInput(opsStartReplayInputSchema)
          .withOutput(opsReplayStartedSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const user = ctx.session?.user;
            const userName = user?.name ?? user?.email ?? "unknown";

            try {
              return await ctx.app.ops.replay.startReplay({
                projectionNames: input.projectionNames,
                since: input.since,
                tenantIds: input.tenantIds ?? [],
                aggregateIds: input.aggregateIds,
                fullRebuild: input.fullRebuild,
                description: input.description,
                userName,
              });
            } catch (err) {
              // Left as a raw TRPCError deliberately, and it is the one refusal
              // on this surface that is. The branch answers CONFLICT for EVERY
              // failure, including infrastructure ones: "already running" is a
              // nameable cause a caller can act on, and everything else is not.
              // Splitting it — a handled conflict for the first, the original
              // error for the rest — is the correct shape, and it changes what
              // an infrastructure failure puts on the wire from CONFLICT to a
              // 500. That is a behaviour change, so it is reported rather than
              // taken here.
              const rawMessage = err instanceof Error ? err.message : String(err);
              const safeMessage = rawMessage.includes("already running")
                ? rawMessage
                : "Replay could not be started";
              throw new TRPCError({
                code: "CONFLICT",
                message: safeMessage,
              });
            }
          }),
      )
      .query("getReplayStatus", (p) =>
        p
          .withoutInput("there is at most one run at a time")
          .withOutput(replayStatusSchema)
          .withPermission("ops:view")
          .handle(async ({ ctx }) => ctx.app.ops.replay.getStatus()),
      )
      .mutation("cancelReplay", (p) =>
        p
          .withoutInput("cancels the one run that can be in flight")
          .withOutput(opsReplayCancelledSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx }) => ctx.app.ops.replay.cancelReplay()),
      )
      .build();

    const deadLetters = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("listDlqGroups", (p) =>
        p
          .withInput(opsQueueNameInputSchema)
          .withOutput(opsQueueDlqGroupSchema.array())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.listQueueDlqGroups(input);
          }),
      )
      .query("listAllDlqGroups", (p) =>
        p
          .withoutInput("the dead-letter set across every queue")
          .withOutput(opsQueueDlqGroupWithQueueSchema.array())
          .withPermission("ops:view")
          .handle(async ({ ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.listAllQueueDlqGroups();
          }),
      )
      .query("listPausedKeys", (p) =>
        p
          .withInput(opsQueueNameInputSchema)
          .withOutput(opsQueueNameListSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.listPausedQueueKeys(input);
          }),
      )
      .query("drainAllBlockedPreview", (p) =>
        p
          .withInput(opsQueueFilterInputSchema)
          .withOutput(opsQueueDrainPreviewSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.getQueueDrainPreview(input);
          }),
      )
      .mutation("moveToDlq", (p) =>
        p
          .withInput(opsQueueGroupInputSchema)
          .withOutput(opsQueueMovedToDlqSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.moveQueueGroupToDlq({
              ...input,
              requestedBy: ctx.actor().id,
            });
          }),
      )
      .mutation("moveAllBlockedToDlq", (p) =>
        p
          .withInput(opsQueueFilterInputSchema)
          .withOutput(opsQueueMovedAllToDlqSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.moveAllBlockedQueueGroupsToDlq({
              ...input,
              requestedBy: ctx.actor().id,
            });
          }),
      )
      .mutation("replayFromDlq", (p) =>
        p
          .withInput(opsQueueGroupInputSchema)
          .withOutput(opsQueueReplayedFromDlqSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.replayQueueGroupFromDlq(input);
          }),
      )
      .mutation("replayAllFromDlq", (p) =>
        p
          .withInput(opsQueueFilterInputSchema)
          .withOutput(opsQueueReplayedAllFromDlqSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.replayAllQueueGroupsFromDlq(input);
          }),
      )
      /**
       * Redrive exactly the DLQ groups the operator's filter showed
       * (specs/ops/dead-letter-recovery.feature) — explicit ids, so the
       * confirmation and the act cover the same groups.
       */
      .mutation("redriveManyFromDlq", (p) =>
        p
          .withInput(opsQueueGroupIdsInputSchema)
          .withOutput(opsQueueRedrivenDlqGroupsSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.ops.operations.redriveQueueDlqGroups({
              ...input,
              requestedBy: ctx.actor().id,
            }),
          ),
      )
      /**
       * Discard exactly the shown DLQ groups: their jobs never run again. The
       * audit row is the retained mark — the Redis entries expire regardless.
       */
      .mutation("discardManyFromDlq", (p) =>
        p
          .withInput(opsQueueGroupIdsInputSchema)
          .withOutput(opsQueueDiscardedDlqGroupsSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.ops.operations.discardQueueDlqGroups({
              ...input,
              requestedBy: ctx.actor().id,
            }),
          ),
      )
      .mutation("canaryRedrive", (p) =>
        p
          .withInput(opsQueueCanaryInputSchema)
          .withOutput(opsQueueCanaryRedrivenSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.canaryRedriveQueueDlq(input);
          }),
      )
      .mutation("canaryUnblock", (p) =>
        p
          .withInput(opsQueueCanaryInputSchema)
          .withOutput(opsQueueCanaryUnblockedSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const ops = ctx.app.ops.operations;
            return ops.canaryUnblockQueueGroups(input);
          }),
      )
      .build();

    const eventLog = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("searchAggregates", (p) =>
        p
          .withInput(opsSearchAggregatesInputSchema)
          .withOutput(opsAggregateSearchSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => {
            const DEFAULT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
            const sinceMs = input.sinceMs ?? nowInstant().epochMilliseconds - DEFAULT_LOOKBACK_MS;

            return ctx.app.ops.events.searchAggregates({
              query: input.query,
              tenantIds: input.tenantId ? [input.tenantId] : [],
              sinceMs,
            });
          }),
      )
      // Exposes (a) the 1-year DejaView search default and (b) the env-var-
      // derived hot-tier window for event_log so the DejaView UI can render
      // the banner under the search box. Cold-tier reads still work but get
      // quite some slower; the banner makes the bound visible up front.
      .query("getEventLogSearchWindow", (p) =>
        p
          .withoutInput("one deployment-wide bound on every event-log search")
          .withOutput(opsEventLogSearchWindowSchema)
          .withPermission("ops:view")
          .handle(() => ports.getEventLogSearchWindow()),
      )
      .query("loadAggregateEvents", (p) =>
        p
          .withInput(opsLoadAggregateEventsInputSchema)
          .withOutput(opsAggregateEventsSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.events.getAggregateEvents(input)),
      )
      .query("computeProjectionState", (p) =>
        p
          .withInput(opsComputeProjectionStateInputSchema)
          .withOutput(opsProjectionStateSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.computeProjectionState(input)),
      )

      // ─────────────────────────────────────────────────────────────────────
      // Tenant anomalies (post-2026-05-11 incident follow-up).
      // ─────────────────────────────────────────────────────────────────────

      /**
       * List currently-active tenant anomalies (rate breaker + structural
       * fingerprint loops). Sorted with hard-tier first.
       */
      .query("listAnomalies", (p) =>
        p
          .withoutInput("every active anomaly, across every tenant")
          .withOutput(opsAnomalyListingSchema)
          .withPermission("ops:view")
          .handle(async ({ ctx }) => {
            const anomalies = await ctx.app.ops.listAnomalies();
            return { anomalies };
          }),
      )
      /**
       * Dismiss an active anomaly manually. The next detector tick may
       * resurface it if conditions are still met — this is just an operator
       * ack to stop the badge from blinking.
       */
      .mutation("dismissAnomaly", (p) =>
        p
          .withInput(opsDismissAnomalyInputSchema)
          .withOutput(opsAnomalyDismissedSchema)
          .withPermission("ops:manage")
          .handle(async ({ input, ctx }) => {
            const dismissed = await ctx.app.ops.dismissAnomaly(input);
            return { dismissed };
          }),
      )
      .build();

    const blobStore = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * Lists every registered feature flag plus any orphaned postgres
       * rows. Operators use this to see the source of truth for each flag
       * (registry default vs postgres override vs env override) before
       * flipping anything.
       *
       * Read-only: no PostHog calls happen on this path either, so opening
       * the page does not cost a flag call.
       */
      .query("listFeatureFlags", (p) =>
        p
          .withoutInput("the whole registry; a flag is not addressed by a scope")
          .withOutput(operatorFeatureFlagCatalogueSchema)
          .withPermission("ops:view")
          .handle(async ({ ctx }) => ctx.app.ops.featureFlagCatalogue()),
      )
      .mutation("setFeatureFlag", (p) =>
        p
          .withInput(opsSetFeatureFlagInputSchema)
          .withOutput(opsOkOutputSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.ops.setFeatureFlagEnabled({
              key: input.key,
              enabled: input.enabled,
              lastEditedBy: ctx.actor().id,
            });
            return { ok: true as const };
          }),
      )
      .mutation("setFeatureFlagRules", (p) =>
        p
          .withInput(
            opsFeatureFlagKeyInputSchema.extend({
              // Write-time only — the read path's `parseRules` must keep accepting
              // whatever is already stored, so the refinements live on their own
              // schema. What they catch is a rule that cannot match anything and
              // therefore silently does nothing: a blank or padded id, and a
              // new-organizations date that cannot be read.
              rules: featureFlagRulesWriteSchema,
            }),
          )
          .withOutput(opsOkOutputSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.ops.setFeatureFlagRules({
              key: input.key,
              rules: input.rules,
              lastEditedBy: ctx.actor().id,
            });
            return { ok: true as const };
          }),
      )
      .mutation("clearFeatureFlag", (p) =>
        p
          .withInput(opsFeatureFlagKeyInputSchema)
          .withOutput(opsOkOutputSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.ops.clearFeatureFlag({
              key: input.key,
              lastEditedBy: ctx.actor().id,
            });
            return { ok: true as const };
          }),
      )

      // ─────────────────────────────────────────────────────────────────────
      // Blob store (group queue content-addressed payloads)
      //
      // Reads are ops:view. Everything that can destroy a payload additionally
      // requires a non-impersonated session and a typed confirmation — see
      // `requireDestructiveOpsAuth`.
      // ─────────────────────────────────────────────────────────────────────

      .query("listBlobQueues", (p) =>
        p
          .withoutInput("every queue holding blobs")
          .withOutput(opsQueueNameListSchema)
          .withPermission("ops:view")
          .handle(async ({ ctx }) => ctx.app.ops.operations.listBlobQueues()),
      )
      .query("getBlobStoreStats", (p) =>
        p
          .withoutInput("one store-wide reading")
          .withOutput(opsBlobStoreStatsSchema)
          .withPermission("ops:view")
          .handle(async ({ ctx }) => ctx.app.ops.operations.getBlobStoreStats()),
      )
      .query("listBlobs", (p) =>
        p
          .withInput(listBlobsInputSchema)
          .withOutput(opsBlobPageSchema)
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.operations.listBlobs(input)),
      )
      .query("getBlob", (p) =>
        p
          .withInput(getBlobInputSchema)
          .withOutput(opsBlobSummarySchema.nullable())
          .withPermission("ops:view")
          .handle(async ({ input, ctx }) => ctx.app.ops.operations.tryGetBlob(input)),
      )
      .mutation("runBlobCleanup", (p) =>
        p
          .withInput(runBlobCleanupOperatorInputSchema)
          .withOutput(blobSweepReportSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            if (!input.dryRun) {
              requireDestructiveOpsAuth(ctx, input.confirm);
            }
            return ctx.app.ops.operations.runBlobCleanup({
              dryRun: input.dryRun,
              // Opaque id, not email: the audit trail must trace the actor without
              // carrying PII into the log stream.
              requestedBy: ctx.actor().id,
            });
          }),
      )
      .mutation("deleteBlob", (p) =>
        p
          .withInput(deleteBlobOperatorInputSchema)
          .withOutput(deleteBlobResultSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            requireDestructiveOpsAuth(ctx, input.confirm);
            return ctx.app.ops.operations.deleteBlob({
              queueName: input.queueName,
              projectId: input.projectId,
              hash: input.hash,
              // Opaque id, not email: the audit trail must trace the actor without
              // carrying PII into the log stream.
              requestedBy: ctx.actor().id,
            });
          }),
      )
      .build();

    const migrations = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * The in-place system migrations (@langwatch/system-migrations), per
       * migration: status rollup plus the tenants needing attention - held
       * (`migrated`, parity disagreements in the report) and `parked` (errored,
       * retried next pass). Finalized tenants are a count, not a listing.
       */
      .query("listSystemMigrations", (p) =>
        p
          .withoutInput("every registered migration")
          .withOutput(opsMigrationOverviewSchema.array())
          .withPermission("ops:view")
          .handle(() => ports.systemMigrations.getOverview()),
      )
      /**
       * The cloud rollout's enrollment listing: which organizations are enrolled
       * for which migrations, with the names the operator recognizes. Carries
       * `isSaaS` so the page can say honestly that a self-hosted installation
       * has nothing to enroll.
       */
      .query("listMigrationEnrollments", (p) =>
        p
          .withoutInput("every enrollment; the read itself is what is audited")
          .withOutput(opsMigrationEnrollmentListingSchema)
          .withPermission("ops:view")
          .handle(({ ctx }) =>
            ports.systemMigrations.getEnrollments({ requestedBy: ctx.actor().id }),
          ),
      )
      /**
       * The organization lookup behind the page's pickers: enroll, targeted run
       * and rollback all act on an organization found by name or exact id.
       */
      .query("searchMigrationOrganizations", (p) =>
        p
          .withInput(opsSearchMigrationOrganizationsInputSchema)
          .withOutput(opsMigrationOrganizationMatchSchema.array())
          .withPermission("ops:view")
          .handle(({ input }) =>
            ports.systemMigrations.searchOrganizations({ query: input.query }),
          ),
      )
      /**
       * Enroll one organization for one registered migration. Takes effect on
       * the next pass - enrollment is read fresh each time. The service refuses
       * duplicates, unknown migrations, unknown organizations, migrations that
       * admit every organization already, and any enrollment on a self-hosted
       * installation, each with a handled error the page renders.
       */
      .mutation("enrollMigrationTenant", (p) =>
        p
          .withInput(opsEnrollMigrationTenantInputSchema)
          .withOutput(opsMigrationEnrolledSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            // The preparation migrations are behavior-neutral (backfill and
            // genesis change nothing about who decides); the cutover has the
            // rollback's blast radius, so it takes the rollback's guard. Which is
            // which comes from the migration's own declaration, so this gate and
            // the page that asks for the confirmation cannot drift apart.
            if (
              ports.systemMigrations.requiresOperatorConfirmation({
                migrationName: input.migrationName,
              })
            ) {
              requireDestructiveOpsAuth(ctx, input.confirm);
            }
            await ports.systemMigrations.enroll({
              organizationId: input.organizationId,
              migrationName: input.migrationName,
              actorUserId: ctx.actor().id,
            });
            return { enrolled: true as const };
          }),
      )
      /**
       * Enroll a sampled cohort of organizations for one migration in a single
       * action. The service draws the sample from organizations not yet
       * enrolled, excluding enterprise plans and private-dataplane routes by
       * data rather than by any list in code. The cutover keeps its typed
       * confirmation: a cohort of cutovers is the same flip N times over.
       *
       * Either exclusion can be lifted for one draw, separately, so finishing a
       * proven rollout does not mean enrolling the held-back organizations one
       * id at a time. Both default to false here as well as in the service: an
       * older client that sends neither field gets the safe pool.
       */
      .mutation("enrollMigrationCohort", (p) =>
        p
          .withInput(opsEnrollMigrationCohortInputSchema)
          .withOutput(opsMigrationCohortResultSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            if (
              ports.systemMigrations.requiresOperatorConfirmation({
                migrationName: input.migrationName,
              })
            ) {
              requireDestructiveOpsAuth(ctx, input.confirm);
            }
            return ports.systemMigrations.enrollCohort({
              migrationName: input.migrationName,
              sampleSize: input.sampleSize,
              actorUserId: ctx.actor().id,
              includeEnterprise: input.includeEnterprise,
              includePrivateDataplane: input.includePrivateDataplane,
            });
          }),
      )
      /**
       * Withdraw an enrollment: later passes stop processing the organization
       * for that migration. State already recorded stays exactly as it is -
       * pausing the rollout is this action's whole job; undoing it is the
       * rollback's. Refused for a migration that admits every organization
       * anyway, where the row it deletes pauses nothing.
       */
      .mutation("withdrawMigrationTenant", (p) =>
        p
          .withInput(opsMigrationTenantInputSchema)
          .withOutput(opsMigrationWithdrawnSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            await ports.systemMigrations.withdraw({
              organizationId: input.organizationId,
              migrationName: input.migrationName,
              actorUserId: ctx.actor().id,
            });
            return { withdrawn: true as const };
          }),
      )
      /**
       * Run one migration for one organization now. Awaited: the operator asked
       * about one organization and gets the status it ended the run in. The
       * service refuses unknown migrations, unknown organizations, an
       * organization outside the migration's cohort (cloud, and only for a
       * migration enrollment still paces) and an organization whose claim
       * another pass already holds, each with a handled error the page renders.
       */
      .mutation("runSystemMigrationForOrganization", (p) =>
        p
          .withInput(opsRunSystemMigrationForOrganizationInputSchema)
          .withOutput(opsMigrationTargetedRunResultSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            if (
              ports.systemMigrations.requiresOperatorConfirmation({
                migrationName: input.migrationName,
              })
            ) {
              requireDestructiveOpsAuth(ctx, input.confirm);
            }
            return ports.systemMigrations.runForOrganization({
              organizationId: input.organizationId,
              migrationName: input.migrationName,
              actorUserId: ctx.actor().id,
            });
          }),
      )
      /**
       * Kick a migration pass now instead of waiting for the next worker boot -
       * the lever for processing a fresh enrollment right away or re-verifying
       * held tenants after remediation. Fire-and-forget: per-organization claims
       * already keep two passes off the same organization, so the worst case for
       * a double click is a pass that finds everything claimed and does nothing.
       */
      .mutation("runSystemMigrationPass", (p) =>
        p
          .withoutInput("a pass covers whatever is enrolled when it runs")
          .withOutput(opsMigrationPassStartedSchema)
          .withPermission("ops:manage")
          .handle(() => {
            ports.systemMigrations.startPass();
            return { started: true as const };
          }),
      )
      .mutation("assertSystemMigrationLegacyWritersDrained", (p) =>
        p
          .withInput(opsAssertLegacyWritersDrainedInputSchema)
          .withOutput(opsMigrationDrainAssertedSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            requireDestructiveOpsAuth(ctx, input.confirm);
            await ports.systemMigrations.assertLegacyWritersDrained({
              migrationName: input.migrationName,
              tenantId: input.tenantId,
              minimumWriterGeneration: input.minimumWriterGeneration,
              actorUserId: ctx.actor().id,
            });
            return { asserted: true as const };
          }),
      )
      /**
       * The operator rollback: pin a migrated or finalized organization back
       * onto its legacy path. Both are already live on the ledger; the service
       * refuses anything else with a handled error. An already `rolled_back`
       * organization RETRIES — calling this again re-applies the rollback's
       * effects against the standing pin, which is how a rollback whose effect
       * died halfway is finished. Rolled-back tenants are terminal for the
       * runner — later passes leave them alone.
       */
      .mutation("rollBackSystemMigrationTenant", (p) =>
        p
          .withInput(opsRollBackSystemMigrationTenantInputSchema)
          .withOutput(opsMigrationRolledBackSchema)
          .withPermission("ops:manage")
          .handle(async ({ ctx, input }) => {
            // Same posture as the blob-store writes: this procedure is callable
            // without the dialog, and it decides which tables answer every
            // permission check for an entire organization.
            requireDestructiveOpsAuth(ctx, input.confirm);
            await ports.systemMigrations.rollBack({
              migrationName: input.migrationName,
              tenantId: input.tenantId,
              actorUserId: ctx.actor().id,
            });
            return { rolledBack: true as const };
          }),
      )
      .build();

    // One surface, defined in the groups the dashboard is laid out in.
    // Several chains rather than one because a single ninety-procedure
    // chain exceeds TypeScript's instantiation depth, and `mergeRouters`
    // puts them back on the one `ops.*` name the client has always called.
    return trpc.mergeRouters(
      dashboard,
      scheduler,
      queues,
      processes,
      replay,
      deadLetters,
      eventLog,
      blobStore,
      migrations,
    );
  }
}
