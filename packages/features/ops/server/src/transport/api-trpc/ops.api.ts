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
import {
  deleteBlobOperatorInputSchema,
  getBlobInputSchema,
  listBlobsInputSchema,
  opsAggregateProcessManagersInputSchema,
  opsAssertLegacyWritersDrainedInputSchema,
  opsComputeProjectionStateInputSchema,
  opsDiscardDeadLettersInputSchema,
  opsDiscoverAggregatesInputSchema,
  opsDismissAnomalyInputSchema,
  opsDrainQueueTenantInputSchema,
  opsDryRunReplayInputSchema,
  opsEnrollMigrationCohortInputSchema,
  opsEnrollMigrationTenantInputSchema,
  opsFeatureFlagKeyInputSchema,
  opsGetReplayRunInputSchema,
  opsListDeadLettersInputSchema,
  opsListOutboxAttemptsInputSchema,
  opsListParkedQueueGroupsInputSchema,
  opsListPausedSchedulesInputSchema,
  opsListProcessActionsInputSchema,
  opsListProcessInstancesInputSchema,
  opsListProcessOutboxInputSchema,
  opsListQueueGroupJobsInputSchema,
  opsListQueueGroupsInputSchema,
  opsListScheduledJobsInputSchema,
  opsListSchedulerActionsInputSchema,
  opsListUpcomingWakesInputSchema,
  opsLoadAggregateEventsInputSchema,
  opsMigrationTenantInputSchema,
  opsOkOutputSchema,
  opsProcessMessageInputSchema,
  opsProcessRefInputSchema,
  opsQueueCanaryInputSchema,
  opsQueueFilterInputSchema,
  opsQueueGroupIdsInputSchema,
  opsQueueGroupInputSchema,
  opsQueueNameInputSchema,
  opsQueuePipelineInputSchema,
  opsQueueTenantInputSchema,
  opsRedriveDeadLettersInputSchema,
  opsRequeueDeadOutboxMessagesInputSchema,
  opsRetryBlockedQueueJobInputSchema,
  opsRollBackSystemMigrationTenantInputSchema,
  opsRunSystemMigrationForOrganizationInputSchema,
  opsScheduleIdInputSchema,
  opsSearchAggregatesInputSchema,
  type OpsMigrationCohortResult,
  type OpsMigrationEnrollmentListing,
  type OpsMigrationOrganizationMatch,
  type OpsApiGetBadgeCountsOutput,
  type OpsMigrationOverview,
  type OpsMigrationTargetedRunResult,
  opsSearchMigrationOrganizationsInputSchema,
  opsSearchTenantsInputSchema,
  opsSetFeatureFlagInputSchema,
  opsSetScheduleActiveInputSchema,
  opsStartReplayInputSchema,
  runBlobCleanupOperatorInputSchema,
} from "@langwatch/ops-contract";
import {
  featureFlagRulesSchema,
  operatorFeatureFlagCatalogueSchema,
} from "@langwatch/feature-flag-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import type { OpsApp, OpsOperator } from "#app/ops.app";

/**
 * The operator's reach, as the process resolved it. `none` is an answer rather
 * than a refusal so the global menu can poll without spamming the console.
 */
export type OpsScope = { kind: "none" } | { kind: "platform" };

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
  probePolicy<TProcedure>(procedure: TProcedure): TProcedure;
}>;

/**
 * One registered projection, as the process's pipeline registry knows it.
 *
 * Structural rather than imported: the registry is the process's, and this
 * transport only publishes what it answers. Named fields, not `unknown` — a
 * tRPC procedure publishes what its handler returns, so an `unknown` here is
 * what the browser gets, and every ops surface reading a projection row was
 * reading `kind`, `pipelineName` and `projectionName` off `{}`.
 */
export type OpsProjectionRegistration = Readonly<{
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  /** Whether the projection is declared on a pipeline or registered globally. */
  source: "pipeline" | "global";
  /** The queue path a pause targets. */
  pauseKey: string;
  kind: "fold" | "map" | "state";
}>;

/** One registered event subscriber, and the event types it reacts to. */
export type OpsEventSubscriberRegistration = Readonly<{
  subscriberName: string;
  pipelineName: string;
  aggregateType: string;
  /** The event types this subscriber reacts to — its transition triggers. */
  eventTypes: readonly string[];
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
    const view = policy("ops:view");
    const manage = policy("ops:manage");

    return trpc.router({
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
      getScope: probePolicy(procedure).query(({ ctx }) => {
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

      getDashboardSnapshot: view(procedure).query(({ ctx }) => {
        return ctx.app.ops.tryGetDashboardData();
      }),

      /**
       * Cheap counts-only query for the global ops badge in the main menu.
       * Returns just the two integers the badge renders (blocked groups +
       * DLQ jobs), bypassing the full dashboard aggregation. Use this for
       * always-on polling; reach for `getDashboardSnapshot` only on the
       * ops route itself.
       */
      getBadgeCounts: view(procedure).query(({ ctx }): OpsApiGetBadgeCountsOutput =>
        ctx.app.ops.badgeCounts(),
      ),

      dashboardStream: view(procedure).subscription(async function* ({ signal, ctx }) {
        yield* ctx.app.ops.streamDashboard({ signal });
      }),

      /**
       * One parked tenant's groups, read live rather than from the snapshot.
       *
       * A parking storm can hold hundreds of thousands of groups; carrying those
       * in a snapshot every pod reads would recreate the size problem ADR-090
       * removes. The tenant ROWS ship in the snapshot, their members do not.
       */
      listParkedGroups: view(procedure.input(opsListParkedQueueGroupsInputSchema)).query(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.listParkedQueueGroups(input);
        },
      ),

      listQueues: view(procedure).query(async ({ ctx }) => {
        const ops = ctx.app.ops.operations;
        return ops.listQueues();
      }),

      listScheduledJobs: view(procedure.input(opsListScheduledJobsInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.operations.listScheduledJobs({ limit: input.limit });
        },
      ),

      /**
       * Only the switched-off schedules, for the dashboard's "Switched off"
       * panel. Its own read because `listScheduledJobs` sorts active first, so a
       * client filtering that page would miss every paused row on a large fleet.
       */
      listPausedSchedules: view(procedure.input(opsListPausedSchedulesInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.operations.listPausedSchedules({ limit: input.limit });
        },
      ),

      /** Recent scheduler operator actions, so the page explains its own history. */
      listSchedulerActions: view(procedure.input(opsListSchedulerActionsInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.operations.listSchedulerActions({ limit: input.limit });
        },
      ),

      /**
       * Pause or resume a schedule (ADR-091). Never touches an in-flight slot —
       * the confirmation copy says so, because a pause that silently killed a
       * live run would be a much larger promise than the one being made.
       */
      setScheduleActive: manage(procedure.input(opsSetScheduleActiveInputSchema)).mutation(
        async ({ input, ctx }) => {
          return ctx.app.ops.operations.setScheduleActive({
            scheduleId: input.scheduleId,
            active: input.active,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      /** Release a slot whose worker stopped responding, so it can be claimed again. */
      clearScheduleSlot: manage(procedure.input(opsScheduleIdInputSchema)).mutation(
        async ({ input, ctx }) => {
          return ctx.app.ops.operations.clearStuckScheduleSlot({
            scheduleId: input.scheduleId,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      /**
       * Make a schedule due immediately. The loop claims and runs it through the
       * ordinary path, so this inherits its exactly-once lease rather than
       * bypassing it.
       */
      runScheduleNow: manage(procedure.input(opsScheduleIdInputSchema)).mutation(
        async ({ input, ctx }) => {
          return ctx.app.ops.operations.runScheduleNow({
            scheduleId: input.scheduleId,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      listGroups: view(procedure.input(opsListQueueGroupsInputSchema)).query(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.listQueueGroups(input);
        },
      ),

      getGroupDetail: view(procedure.input(opsQueueGroupInputSchema)).query(
        async ({ input, ctx }) => ctx.app.ops.getQueueGroup(input),
      ),

      /**
       * The Grafana deep-link config, so ops surfaces can build per-row Explore
       * links client-side with pure builders. Null when no Grafana is
       * configured — callers render no link rather than a dead one. Gated like
       * every other ops read; Grafana itself is access-controlled, so the base
       * URL is not a secret to an operator.
       */
      getGrafanaLinkConfig: view(procedure).query(() => {
        return ports.tryGetGrafanaLinkConfig();
      }),

      getBlockedSummary: view(procedure).query(async ({ ctx }) => {
        const ops = ctx.app.ops.operations;
        return ops.getBlockedQueueSummary();
      }),

      getGroupJobs: view(procedure.input(opsListQueueGroupJobsInputSchema)).query(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.listQueueGroupJobs(input);
        },
      ),

      unblockGroup: manage(procedure.input(opsQueueGroupInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.unblockQueueGroup(input);
        },
      ),

      unblockAll: manage(procedure.input(opsQueueNameInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.unblockAllQueueGroups(input);
        },
      ),

      drainGroup: manage(procedure.input(opsQueueGroupInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.drainQueueGroup(input);
        },
      ),

      pausePipeline: manage(procedure.input(opsQueuePipelineInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.pauseQueuePipeline(input);
        },
      ),

      unpausePipeline: manage(procedure.input(opsQueuePipelineInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.unpauseQueuePipeline(input);
        },
      ),

      pauseTenant: manage(procedure.input(opsQueueTenantInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.pauseQueueTenant(input);
        },
      ),

      unpauseTenant: manage(procedure.input(opsQueueTenantInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.unpauseQueueTenant(input);
        },
      ),

      listPausedTenants: view(procedure.input(opsQueueNameInputSchema)).query(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.listPausedQueueTenants(input);
        },
      ),

      drainTenant: manage(procedure.input(opsDrainQueueTenantInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.drainQueueTenant(input);
        },
      ),

      retryBlocked: manage(procedure.input(opsRetryBlockedQueueJobInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.retryBlockedQueueJob(input);
        },
      ),

      listProjections: view(procedure).query(() => {
        return ports.listPipelineRegistrations();
      }),

      /**
       * The per-aggregate process-manager state machines for one aggregate: each
       * machine's definition (triggers, intents, wake) joined to this aggregate's
       * current instance state and the intents it has emitted. Scheduled
       * singletons are excluded — they are not keyed by aggregate id.
       */
      getAggregateProcessManagers: view(
        procedure.input(opsAggregateProcessManagersInputSchema),
      ).query(async ({ input, ctx }) => {
        return ctx.app.ops.processes.getForAggregate({
          aggregateType: input.aggregateType,
          projectId: input.tenantId,
          aggregateId: input.aggregateId,
        });
      }),

      /**
       * Dead-letter recovery: requeue one process instance's DEAD outbox rows
       * (optionally narrowed by message-key prefix) as pending, due now, with a
       * fresh attempt budget. The webhook platform's re-enable flow points here
       * for batches that exhausted the retry ladder.
       */
      requeueDeadOutboxMessages: manage(
        procedure.input(opsRequeueDeadOutboxMessagesInputSchema),
      ).mutation(async ({ ctx, input }) => {
        return ctx.app.ops.processes.requeueDeadMessages({
          processName: input.processName,
          projectId: input.tenantId,
          processKey: input.processKey,
          messageKeyPrefix: input.messageKeyPrefix,
          requestedBy: ctx.actor().id,
        });
      }),

      // ── Process-manager fleet (specs/ops/process-manager-visibility.feature) ──

      /** One row per process name: registry identity + live trouble counts. */
      listProcessFleet: view(procedure).query(({ ctx }) => {
        return ctx.app.ops.processes.getFleetSummary();
      }),

      /**
       * Retired messages across every process. Answers "what has permanently
       * stopped", which `getProcessOutbox` could not: that one needs a full
       * process ref, so it can only be reached by an operator who already knows
       * where the failure is.
       */
      listDeadLetters: view(procedure.input(opsListDeadLettersInputSchema)).query(
        ({ input, ctx }) => {
          return ctx.app.ops.processes.getDeadLetters(input);
        },
      ),

      /** Dead totals per process, for the navigation badge and dashboard card. */
      listDeadLetterCounts: view(procedure).query(({ ctx }) => {
        return ctx.app.ops.processes.getDeadLetterCounts();
      }),

      listProcessInstances: view(procedure.input(opsListProcessInstancesInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.processes.getInstances(input);
        },
      ),

      /** The soonest-due process wakes, for the dashboard's timed-work table. */
      listUpcomingWakes: view(procedure.input(opsListUpcomingWakesInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.processes.getUpcomingWakes(input);
        },
      ),

      getProcessInstance: view(procedure.input(opsProcessRefInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.processes.getInstanceDetail({ ref: input });
        },
      ),

      listProcessOutbox: view(procedure.input(opsListProcessOutboxInputSchema)).query(
        async ({ input, ctx }) => {
          const { page, pageSize, ...ref } = input;
          return ctx.app.ops.processes.getOutbox({ ref, page, pageSize });
        },
      ),

      listProcessActions: view(procedure.input(opsListProcessActionsInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.processes.listRecentActions(input);
        },
      ),

      processWakeNow: manage(procedure.input(opsProcessRefInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.ops.processes.wakeNow({
            ref: input,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      processRedriveDeadInstance: manage(procedure.input(opsProcessRefInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.ops.processes.redriveDeadInstance({
            ref: input,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      processRedriveDeadMessage: manage(procedure.input(opsProcessMessageInputSchema)).mutation(
        async ({ ctx, input }) => {
          const { messageId, ...ref } = input;
          return ctx.app.ops.processes.redriveDeadMessage({
            ref,
            messageId,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      /** Mark one dead message never-to-be-sent — a mark, not a delete. */
      processDiscardDeadMessage: manage(procedure.input(opsProcessMessageInputSchema)).mutation(
        async ({ ctx, input }) => {
          const { messageId, ...ref } = input;
          return ctx.app.ops.processes.discardDeadMessage({
            ref,
            messageId,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      /**
       * Every dead letter back to pending — one process, or the fleet when
       * `processName` is omitted (specs/ops/dead-letter-recovery.feature).
       */
      redriveDeadLetters: manage(procedure.input(opsRedriveDeadLettersInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.ops.processes.redriveDeadLetters({
            ...input,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      /**
       * Every dead letter marked discarded; same scoping as the redrive.
       *
       * The fleet-wide form — no `processName` — crosses every tenant and cannot
       * be undone, since no redrive path selects a discarded row. It therefore
       * takes a typed confirmation, the same shape the blob-store delete uses:
       * the destructive breadth has to be reached deliberately, not by omitting
       * a field (best_practices/ops-dashboard.md).
       */
      discardDeadLetters: manage(procedure.input(opsDiscardDeadLettersInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.ops.processes.discardDeadLetters({
            ...(input.processName ? { processName: input.processName } : {}),
            actorUserId: ctx.actor().id,
          });
        },
      ),

      /** The message's failed attempts, oldest first — why a dead letter died. */
      listOutboxAttempts: view(procedure.input(opsListOutboxAttemptsInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.processes.getOutboxAttempts(input);
        },
      ),

      processReleaseLapsedLease: manage(procedure.input(opsProcessMessageInputSchema)).mutation(
        async ({ ctx, input }) => {
          const { messageId, ...ref } = input;
          return ctx.app.ops.processes.releaseLapsedLease({
            ref,
            messageId,
            actorUserId: ctx.actor().id,
          });
        },
      ),

      discoverAggregates: view(procedure.input(opsDiscoverAggregatesInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.events.discoverAggregates({
            projectionNames: input.projectionNames,
            since: input.since,
            tenantIds: input.tenantIds ?? [],
          });
        },
      ),

      searchTenants: view(procedure.input(opsSearchTenantsInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.searchProjects({ query: input.query });
        },
      ),

      dryRunReplay: manage(procedure.input(opsDryRunReplayInputSchema)).mutation(
        async ({ input }) => {
          return {
            status: "coming_soon" as const,
            message: "Dry run is not yet implemented. Full replay will process all aggregates.",
            projectionNames: input.projectionNames,
            sampleSize: input.sampleSize,
          };
        },
      ),

      getReplayHistory: view(procedure).query(async ({ ctx }) => {
        return ctx.app.ops.replay.getHistory();
      }),

      getReplayRun: view(procedure.input(opsGetReplayRunInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.replay.findHistoryEntry({ runId: input.runId });
        },
      ),

      startReplay: manage(procedure.input(opsStartReplayInputSchema)).mutation(
        async ({ input, ctx }) => {
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
        },
      ),

      getReplayStatus: view(procedure).query(async ({ ctx }) => {
        return ctx.app.ops.replay.getStatus();
      }),

      cancelReplay: manage(procedure).mutation(async ({ ctx }) => {
        return ctx.app.ops.replay.cancelReplay();
      }),

      listDlqGroups: view(procedure.input(opsQueueNameInputSchema)).query(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.listQueueDlqGroups(input);
        },
      ),

      listAllDlqGroups: view(procedure).query(async ({ ctx }) => {
        const ops = ctx.app.ops.operations;
        return ops.listAllQueueDlqGroups();
      }),

      listPausedKeys: view(procedure.input(opsQueueNameInputSchema)).query(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.listPausedQueueKeys(input);
        },
      ),

      drainAllBlockedPreview: view(procedure.input(opsQueueFilterInputSchema)).query(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.getQueueDrainPreview(input);
        },
      ),

      moveToDlq: manage(procedure.input(opsQueueGroupInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.moveQueueGroupToDlq(input);
        },
      ),

      moveAllBlockedToDlq: manage(procedure.input(opsQueueFilterInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.moveAllBlockedQueueGroupsToDlq(input);
        },
      ),

      replayFromDlq: manage(procedure.input(opsQueueGroupInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.replayQueueGroupFromDlq(input);
        },
      ),

      replayAllFromDlq: manage(procedure.input(opsQueueFilterInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.replayAllQueueGroupsFromDlq(input);
        },
      ),

      /**
       * Redrive exactly the DLQ groups the operator's filter showed
       * (specs/ops/dead-letter-recovery.feature) — explicit ids, so the
       * confirmation and the act cover the same groups.
       */
      redriveManyFromDlq: manage(procedure.input(opsQueueGroupIdsInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.ops.operations.redriveQueueDlqGroups({
            ...input,
            requestedBy: ctx.actor().id,
          });
        },
      ),

      /**
       * Discard exactly the shown DLQ groups: their jobs never run again. The
       * audit row is the retained mark — the Redis entries expire regardless.
       */
      discardManyFromDlq: manage(procedure.input(opsQueueGroupIdsInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.ops.operations.discardQueueDlqGroups({
            ...input,
            requestedBy: ctx.actor().id,
          });
        },
      ),

      canaryRedrive: manage(procedure.input(opsQueueCanaryInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.canaryRedriveQueueDlq(input);
        },
      ),

      canaryUnblock: manage(procedure.input(opsQueueCanaryInputSchema)).mutation(
        async ({ input, ctx }) => {
          const ops = ctx.app.ops.operations;
          return ops.canaryUnblockQueueGroups(input);
        },
      ),

      searchAggregates: view(procedure.input(opsSearchAggregatesInputSchema)).query(
        async ({ input, ctx }) => {
          const DEFAULT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
          const sinceMs = input.sinceMs ?? Date.now() - DEFAULT_LOOKBACK_MS;

          return ctx.app.ops.events.searchAggregates({
            query: input.query,
            tenantIds: input.tenantId ? [input.tenantId] : [],
            sinceMs,
          });
        },
      ),

      // Exposes (a) the 1-year DejaView search default and (b) the env-var-
      // derived hot-tier window for event_log so the DejaView UI can render
      // the banner under the search box. Cold-tier reads still work but get
      // quite some slower; the banner makes the bound visible up front.
      getEventLogSearchWindow: view(procedure).query(() => {
        return ports.getEventLogSearchWindow();
      }),

      loadAggregateEvents: view(procedure.input(opsLoadAggregateEventsInputSchema)).query(
        async ({ input, ctx }) => {
          return ctx.app.ops.events.getAggregateEvents(input);
        },
      ),

      computeProjectionState: view(procedure.input(opsComputeProjectionStateInputSchema)).query(
        async ({ input, ctx }) => ctx.app.ops.computeProjectionState(input),
      ),

      // ─────────────────────────────────────────────────────────────────────
      // Tenant anomalies (post-2026-05-11 incident follow-up).
      // ─────────────────────────────────────────────────────────────────────

      /**
       * List currently-active tenant anomalies (rate breaker + structural
       * fingerprint loops). Sorted with hard-tier first.
       */
      listAnomalies: view(procedure).query(async ({ ctx }) => {
        const anomalies = await ctx.app.ops.listAnomalies();
        return { anomalies };
      }),

      /**
       * Dismiss an active anomaly manually. The next detector tick may
       * resurface it if conditions are still met — this is just an operator
       * ack to stop the badge from blinking.
       */
      dismissAnomaly: manage(procedure.input(opsDismissAnomalyInputSchema)).mutation(
        async ({ input, ctx }) => {
          const dismissed = await ctx.app.ops.dismissAnomaly(input);
          return { dismissed };
        },
      ),

      /**
       * Lists every registered feature flag plus any orphaned postgres
       * rows. Operators use this to see the source of truth for each flag
       * (registry default vs postgres override vs env override) before
       * flipping anything.
       *
       * Read-only: no PostHog calls happen on this path either, so opening
       * the page does not cost a flag call.
       */
      listFeatureFlags: view(procedure)
        .output(operatorFeatureFlagCatalogueSchema)
        .query(async ({ ctx }) => ctx.app.ops.featureFlagCatalogue()),

      setFeatureFlag: manage(procedure.input(opsSetFeatureFlagInputSchema))
        .output(opsOkOutputSchema)
        .mutation(async ({ ctx, input }) => {
          await ctx.app.ops.setFeatureFlagEnabled({
            key: input.key,
            enabled: input.enabled,
            lastEditedBy: ctx.actor().id,
          });
          return { ok: true };
        }),

      setFeatureFlagRules: manage(
        procedure.input(
          opsFeatureFlagKeyInputSchema.extend({
            // Write-time only — the read path's `parseRules` must keep accepting
            // whatever is already stored, so this refinement lives here and not
            // on the shared schema. A blank id can never match any context
            // (matching is exact string equality), so a rule carrying one is a
            // dead rule the operator believes is live.
            rules: featureFlagRulesSchema
              .max(50)
              .refine(
                (rules) =>
                  rules.every((rule) =>
                    [rule.match.projectId, rule.match.organizationId].every(
                      (id) => id === undefined || (id.length > 0 && id === id.trim()),
                    ),
                  ),
                {
                  message: "A targeting rule's project/organization id must not be blank or padded",
                },
              ),
          }),
        ),
      )
        .output(opsOkOutputSchema)
        .mutation(async ({ ctx, input }) => {
          await ctx.app.ops.setFeatureFlagRules({
            key: input.key,
            rules: input.rules,
            lastEditedBy: ctx.actor().id,
          });
          return { ok: true };
        }),

      clearFeatureFlag: manage(procedure.input(opsFeatureFlagKeyInputSchema))
        .output(opsOkOutputSchema)
        .mutation(async ({ ctx, input }) => {
          await ctx.app.ops.clearFeatureFlag({
            key: input.key,
            lastEditedBy: ctx.actor().id,
          });
          return { ok: true };
        }),

      // ─────────────────────────────────────────────────────────────────────
      // Blob store (group queue content-addressed payloads)
      //
      // Reads are ops:view. Everything that can destroy a payload additionally
      // requires a non-impersonated session and a typed confirmation — see
      // `requireDestructiveOpsAuth`.
      // ─────────────────────────────────────────────────────────────────────

      listBlobQueues: view(procedure).query(async ({ ctx }) => {
        return ctx.app.ops.operations.listBlobQueues();
      }),

      getBlobStoreStats: view(procedure).query(async ({ ctx }) => {
        return ctx.app.ops.operations.getBlobStoreStats();
      }),

      listBlobs: view(procedure.input(listBlobsInputSchema)).query(async ({ input, ctx }) => {
        return ctx.app.ops.operations.listBlobs(input);
      }),

      getBlob: view(procedure.input(getBlobInputSchema)).query(async ({ input, ctx }) => {
        return ctx.app.ops.operations.tryGetBlob(input);
      }),

      runBlobCleanup: manage(procedure.input(runBlobCleanupOperatorInputSchema)).mutation(
        async ({ ctx, input }) => {
          if (!input.dryRun) {
            requireDestructiveOpsAuth(ctx, input.confirm);
          }
          return ctx.app.ops.operations.runBlobCleanup({
            dryRun: input.dryRun,
            // Opaque id, not email: the audit trail must trace the actor without
            // carrying PII into the log stream.
            requestedBy: ctx.actor().id,
          });
        },
      ),

      deleteBlob: manage(procedure.input(deleteBlobOperatorInputSchema)).mutation(
        async ({ ctx, input }) => {
          requireDestructiveOpsAuth(ctx, input.confirm);
          return ctx.app.ops.operations.deleteBlob({
            queueName: input.queueName,
            projectId: input.projectId,
            hash: input.hash,
            // Opaque id, not email: the audit trail must trace the actor without
            // carrying PII into the log stream.
            requestedBy: ctx.actor().id,
          });
        },
      ),

      /**
       * The in-place system migrations (@langwatch/system-migrations), per
       * migration: status rollup plus the tenants needing attention - held
       * (`migrated`, parity disagreements in the report) and `parked` (errored,
       * retried next pass). Finalized tenants are a count, not a listing.
       */
      listSystemMigrations: view(procedure).query(() => ports.systemMigrations.getOverview()),

      /**
       * The cloud rollout's enrollment listing: which organizations are enrolled
       * for which migrations, with the names the operator recognizes. Carries
       * `isSaaS` so the page can say honestly that a self-hosted installation
       * has nothing to enroll.
       */
      listMigrationEnrollments: view(procedure).query(({ ctx }) =>
        ports.systemMigrations.getEnrollments({ requestedBy: ctx.actor().id }),
      ),

      /**
       * The organization lookup behind the page's pickers: enroll, targeted run
       * and rollback all act on an organization found by name or exact id.
       */
      searchMigrationOrganizations: view(
        procedure.input(opsSearchMigrationOrganizationsInputSchema),
      ).query(({ input }) => ports.systemMigrations.searchOrganizations({ query: input.query })),

      /**
       * Enroll one organization for one registered migration. Takes effect on
       * the next pass - enrollment is read fresh each time. The service refuses
       * duplicates, unknown migrations, unknown organizations, migrations that
       * admit every organization already, and any enrollment on a self-hosted
       * installation, each with a handled error the page renders.
       */
      enrollMigrationTenant: manage(procedure.input(opsEnrollMigrationTenantInputSchema)).mutation(
        async ({ ctx, input }) => {
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
          return { enrolled: true };
        },
      ),

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
      enrollMigrationCohort: manage(procedure.input(opsEnrollMigrationCohortInputSchema)).mutation(
        async ({ ctx, input }) => {
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
        },
      ),

      /**
       * Withdraw an enrollment: later passes stop processing the organization
       * for that migration. State already recorded stays exactly as it is -
       * pausing the rollout is this action's whole job; undoing it is the
       * rollback's. Refused for a migration that admits every organization
       * anyway, where the row it deletes pauses nothing.
       */
      withdrawMigrationTenant: manage(procedure.input(opsMigrationTenantInputSchema)).mutation(
        async ({ ctx, input }) => {
          await ports.systemMigrations.withdraw({
            organizationId: input.organizationId,
            migrationName: input.migrationName,
            actorUserId: ctx.actor().id,
          });
          return { withdrawn: true };
        },
      ),

      /**
       * Run one migration for one organization now. Awaited: the operator asked
       * about one organization and gets the status it ended the run in. The
       * service refuses unknown migrations, unknown organizations, an
       * organization outside the migration's cohort (cloud, and only for a
       * migration enrollment still paces) and an organization whose claim
       * another pass already holds, each with a handled error the page renders.
       */
      runSystemMigrationForOrganization: manage(
        procedure.input(opsRunSystemMigrationForOrganizationInputSchema),
      ).mutation(async ({ ctx, input }) => {
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

      /**
       * Kick a migration pass now instead of waiting for the next worker boot -
       * the lever for processing a fresh enrollment right away or re-verifying
       * held tenants after remediation. Fire-and-forget: per-organization claims
       * already keep two passes off the same organization, so the worst case for
       * a double click is a pass that finds everything claimed and does nothing.
       */
      runSystemMigrationPass: manage(procedure).mutation(() => {
        ports.systemMigrations.startPass();
        return { started: true };
      }),

      assertSystemMigrationLegacyWritersDrained: manage(
        procedure.input(opsAssertLegacyWritersDrainedInputSchema),
      ).mutation(async ({ ctx, input }) => {
        requireDestructiveOpsAuth(ctx, input.confirm);
        await ports.systemMigrations.assertLegacyWritersDrained({
          migrationName: input.migrationName,
          tenantId: input.tenantId,
          minimumWriterGeneration: input.minimumWriterGeneration,
          actorUserId: ctx.actor().id,
        });
        return { asserted: true };
      }),

      /**
       * The operator rollback: pin a migrated or finalized organization back
       * onto its legacy path. Both are already live on the ledger; the service
       * refuses anything else with a handled error. An already `rolled_back`
       * organization RETRIES — calling this again re-applies the rollback's
       * effects against the standing pin, which is how a rollback whose effect
       * died halfway is finished. Rolled-back tenants are terminal for the
       * runner — later passes leave them alone.
       */
      rollBackSystemMigrationTenant: manage(
        procedure.input(opsRollBackSystemMigrationTenantInputSchema),
      ).mutation(async ({ ctx, input }) => {
        // Same posture as the blob-store writes: this procedure is callable
        // without the dialog, and it decides which tables answer every
        // permission check for an entire organization.
        requireDestructiveOpsAuth(ctx, input.confirm);
        await ports.systemMigrations.rollBack({
          migrationName: input.migrationName,
          tenantId: input.tenantId,
          actorUserId: ctx.actor().id,
        });
        return { rolledBack: true };
      }),
    });
  }
}
