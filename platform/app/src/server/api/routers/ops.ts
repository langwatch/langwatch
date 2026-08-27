import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deleteBlobInputSchema,
  getBlobInputSchema,
  listBlobsInputSchema,
  runBlobCleanupInputSchema,
} from "@langwatch/ops-contract";
import { checkOpsPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { systemMigrationsService } from "~/server/app-layer/system-migrations/runtime";
import { resolveHotDays, TABLE_TTL_CONFIG } from "~/server/clickhouse/ttlReconciler";
import {
  getEventSubscriberMetadata,
  getProjectionMetadata,
} from "~/server/event-sourcing/registration/pipelineRegistry";
import {
  featureFlagRulesSchema,
  listFeatureFlags,
  operatorFeatureFlagCatalogueSchema,
} from "@langwatch/feature-flag-contract";
import { grafanaConfigFromEnv } from "~/utils/grafanaLinks";

const opsViewPermission = checkOpsPermission({ permission: "ops:view" });

// Status-probe variant of the ops:view middleware — populates `ctx.opsScope`
// (with `kind: "none"` for non-ops users) without throwing FORBIDDEN. Lets
// `getScope` be a probe that the global menu can poll on every page load
// without spamming the console (lw#3584).
const opsViewProbe = checkOpsPermission({
  permission: "ops:view",
  throwOnDeny: false,
});

const opsManagePermission = checkOpsPermission({ permission: "ops:manage" });
const okOutputSchema = z.object({ ok: z.literal(true) }).strict();

/**
 * The extra gate on an ops write whose damage nobody will notice in time.
 *
 * `ops:manage` already resolves through the admin allow-list, but it is not
 * enough on its own here for two reasons. It is inherited by an impersonation
 * session — `resolveOpsScope` deliberately falls back to the impersonator's own
 * grant — and "acting as" another user is the wrong posture for irreversible
 * infrastructure surgery, because the audit trail names the impersonated
 * account. And the damage is silent: deleting a blob completes the job that
 * referenced it without its handler ever running, and pinning an organization
 * back onto the legacy authorization path changes which tables answer every
 * permission check for that tenant without failing anything. A typed
 * confirmation makes either a deliberate act rather than a mis-click.
 *
 * A confirmation dialog in the ops UI is not this guard — every one of these
 * procedures is callable directly.
 */
function requireDestructiveOpsAuth(
  ctx: {
    session: { user: { impersonator?: { email?: string | null } | null } };
  },
  confirm: string | undefined,
) {
  if (ctx.session.user.impersonator) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This action cannot be run from an impersonated session. Sign in directly to continue.",
    });
  }
  if (!confirm) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This action needs to be confirmed before it can run",
    });
  }
}

export const opsRouter = createTRPCRouter({
  /**
   * Status probe — returns the calling user's ops scope. Always succeeds for
   * any authenticated user; non-ops users get `{ scope: { kind: "none" } }`
   * instead of FORBIDDEN. The hook (`useOpsPermission`) derives `hasAccess`
   * from `scope.kind !== "none"` so the global menu can hide ops UI without
   * spamming the console with permission errors on every page load
   * (lw#3584).
   *
   * The mutating ops endpoints below still go through the throw-on-deny
   * variant of `checkOpsPermission` — only this status probe relaxes it.
   */
  getScope: protectedProcedure.use(opsViewProbe).query(({ ctx }) => {
    if (!ctx.opsScope) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "opsScope not populated by middleware (probable bug)",
      });
    }
    return { scope: ctx.opsScope };
  }),

  getDashboardSnapshot: protectedProcedure.use(opsViewPermission).query(({ ctx }) => {
    return ctx.app.ops.snapshots?.tryGetDashboardData() ?? null;
  }),

  /**
   * Cheap counts-only query for the global ops badge in the main menu.
   * Returns just the two integers the badge renders (blocked groups +
   * DLQ jobs), bypassing the full dashboard aggregation. Use this for
   * always-on polling; reach for `getDashboardSnapshot` only on the
   * ops route itself.
   */
  getBadgeCounts: protectedProcedure.use(opsViewPermission).query(
    ({
      ctx,
    }): {
      blockedCount: number;
      dlqCount: number;
      computedAt: Date | null;
    } => {
      const snapshots = ctx.app.ops.snapshots;
      if (!snapshots) {
        // Same shape as the served path so no caller has to branch on whether
        // the field exists — but `computedAt: null`, because these zeroes are
        // "we cannot say" rather than "nothing is wrong". Stamping the current
        // time would present unavailable data as a fresh all-clear.
        return { blockedCount: 0, dlqCount: 0, computedAt: null };
      }
      return snapshots.getBadgeCounts();
    },
  ),

  dashboardStream: protectedProcedure
    .use(opsViewPermission)
    .subscription(async function* ({ signal, ctx }) {
      const snapshots = ctx.app.ops.snapshots;
      if (!snapshots) {
        return;
      }

      for await (const data of snapshots.streamDashboard({ signal })) {
        yield data;
      }
    }),

  /**
   * One parked tenant's groups, read live rather than from the snapshot.
   *
   * A parking storm can hold hundreds of thousands of groups; carrying those
   * in a snapshot every pod reads would recreate the size problem ADR-090
   * removes. The tenant ROWS ship in the snapshot, their members do not.
   */
  listParkedGroups: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        tenantId: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.listParkedQueueGroups(input);
    }),

  listQueues: protectedProcedure.use(opsViewPermission).query(async ({ ctx }) => {
    const ops = ctx.app.ops;
    return ops.listQueues();
  }),

  listScheduledJobs: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }))
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.listScheduledJobs({ limit: input.limit });
    }),

  /**
   * Only the switched-off schedules, for the dashboard's "Switched off" panel.
   * Its own read because `listScheduledJobs` sorts active first, so a client
   * filtering that page would miss every paused row on a large fleet.
   */
  listPausedSchedules: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.listPausedSchedules({ limit: input.limit });
    }),

  /** Recent scheduler operator actions, so the page explains its own history. */
  listSchedulerActions: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.listSchedulerActions({ limit: input.limit });
    }),

  /**
   * Pause or resume a schedule (ADR-091). Never touches an in-flight slot —
   * the confirmation copy says so, because a pause that silently killed a live
   * run would be a much larger promise than the one being made.
   */
  setScheduleActive: protectedProcedure
    .use(opsManagePermission)
    .input(z.object({ scheduleId: z.string(), active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.app.ops.setScheduleActive({
        scheduleId: input.scheduleId,
        active: input.active,
        actorUserId: ctx.session.user.id,
      });
    }),

  /** Release a slot whose worker stopped responding, so it can be claimed again. */
  clearScheduleSlot: protectedProcedure
    .use(opsManagePermission)
    .input(z.object({ scheduleId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.app.ops.clearStuckScheduleSlot({
        scheduleId: input.scheduleId,
        actorUserId: ctx.session.user.id,
      });
    }),

  /**
   * Make a schedule due immediately. The loop claims and runs it through the
   * ordinary path, so this inherits its exactly-once lease rather than
   * bypassing it.
   */
  runScheduleNow: protectedProcedure
    .use(opsManagePermission)
    .input(z.object({ scheduleId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.app.ops.runScheduleNow({
        scheduleId: input.scheduleId,
        actorUserId: ctx.session.user.id,
      });
    }),

  listGroups: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.listQueueGroups(input);
    }),

  getGroupDetail: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      const group = await ops.tryGetQueueGroup(input);
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Group "${input.groupId}" not found in queue "${input.queueName}"`,
        });
      }
      return group;
    }),

  /**
   * The Grafana deep-link config, so ops surfaces can build per-row Explore
   * links client-side with the pure builders in `~/utils/grafanaLinks`. Null
   * when no Grafana is configured — callers render no link rather than a dead
   * one. Gated like every other ops read; Grafana itself is access-controlled,
   * so the base URL is not a secret to an operator.
   */
  getGrafanaLinkConfig: protectedProcedure.use(opsViewPermission).query(() => {
    const { baseUrl, tempoDatasourceUid, lokiDatasourceUid } = grafanaConfigFromEnv();
    if (!baseUrl) return null;
    return { baseUrl, tempoDatasourceUid, lokiDatasourceUid };
  }),

  getBlockedSummary: protectedProcedure.use(opsViewPermission).query(async ({ ctx }) => {
    const ops = ctx.app.ops;
    return ops.getBlockedQueueSummary();
  }),

  getGroupJobs: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.listQueueGroupJobs(input);
    }),

  unblockGroup: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.unblockQueueGroup(input);
    }),

  unblockAll: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.unblockAllQueueGroups(input);
    }),

  drainGroup: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.drainQueueGroup(input);
    }),

  pausePipeline: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        key: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.pauseQueuePipeline(input);
    }),

  unpausePipeline: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        key: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.unpauseQueuePipeline(input);
    }),

  pauseTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        tenantId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.pauseQueueTenant(input);
    }),

  unpauseTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        tenantId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.unpauseQueueTenant(input);
    }),

  listPausedTenants: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ queueName: z.string() }))
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.listPausedQueueTenants(input);
    }),

  drainTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        tenantId: z.string().min(1),
        // Optional substring filter on groupId. Honest substring semantics —
        // see drainTenant repo doc for example fragments to type.
        groupIdContains: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.drainQueueTenant(input);
    }),

  retryBlocked: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.retryBlockedQueueJob(input);
    }),

  listProjections: protectedProcedure.use(opsViewPermission).query(() => {
    return {
      projections: getProjectionMetadata(),
      eventSubscribers: getEventSubscriberMetadata(),
    };
  }),

  /**
   * The per-aggregate process-manager state machines for one aggregate: each
   * machine's definition (triggers, intents, wake) joined to this aggregate's
   * current instance state and the intents it has emitted. Scheduled singletons
   * are excluded — they are not keyed by aggregate id.
   */
  getAggregateProcessManagers: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        aggregateType: z.string().min(1).max(200),
        tenantId: z.string().min(1).max(200),
        aggregateId: z.string().min(1).max(500),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.managerExplorer.getForAggregate({
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
  requeueDeadOutboxMessages: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200),
        tenantId: z.string().min(1).max(200),
        processKey: z.string().min(1).max(500),
        messageKeyPrefix: z.string().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.app.ops.managerExplorer.requeueDeadMessages({
        processName: input.processName,
        projectId: input.tenantId,
        processKey: input.processKey,
        messageKeyPrefix: input.messageKeyPrefix,
        requestedBy: ctx.session.user.id,
      });
    }),

  // ── Process-manager fleet (specs/ops/process-manager-visibility.feature) ──

  /** One row per process name: registry identity + live trouble counts. */
  listProcessFleet: protectedProcedure.use(opsViewPermission).query(({ ctx }) => {
    return ctx.app.ops.managerExplorer.getFleetSummary();
  }),

  /**
   * Retired messages across every process. Answers "what has permanently
   * stopped", which `getProcessOutbox` could not: that one needs a full
   * process ref, so it can only be reached by an operator who already knows
   * where the failure is.
   */
  listDeadLetters: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        /** Omit for every process. */
        processName: z.string().min(1).max(200).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ input, ctx }) => {
      return ctx.app.ops.managerExplorer.getDeadLetters(input);
    }),

  /** Dead totals per process, for the navigation badge and dashboard card. */
  listDeadLetterCounts: protectedProcedure.use(opsViewPermission).query(({ ctx }) => {
    return ctx.app.ops.managerExplorer.getDeadLetterCounts();
  }),

  listProcessInstances: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        /** Omit to list instances across every process manager. */
        processName: z.string().min(1).max(200).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        search: z.string().max(500).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.managerExplorer.getInstances(input);
    }),

  /** The soonest-due process wakes, for the dashboard's timed-work table. */
  listUpcomingWakes: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.managerExplorer.getUpcomingWakes(input);
    }),

  getProcessInstance: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        processKey: z.string().min(1).max(500),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.managerExplorer.getInstanceDetail({ ref: input });
    }),

  listProcessOutbox: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        processKey: z.string().min(1).max(500),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { page, pageSize, ...ref } = input;
      return ctx.app.ops.managerExplorer.getOutbox({ ref, page, pageSize });
    }),

  listProcessActions: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.managerExplorer.listRecentActions(input);
    }),

  processWakeNow: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        processKey: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.app.ops.managerExplorer.wakeNow({
        ref: input,
        actorUserId: ctx.session.user.id,
      });
    }),

  processRedriveDeadInstance: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        processKey: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.app.ops.managerExplorer.redriveDeadInstance({
        ref: input,
        actorUserId: ctx.session.user.id,
      });
    }),

  processRedriveDeadMessage: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        processKey: z.string().min(1).max(500),
        messageId: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { messageId, ...ref } = input;
      return ctx.app.ops.managerExplorer.redriveDeadMessage({
        ref,
        messageId,
        actorUserId: ctx.session.user.id,
      });
    }),

  /** Mark one dead message never-to-be-sent — a mark, not a delete. */
  processDiscardDeadMessage: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        processKey: z.string().min(1).max(500),
        messageId: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { messageId, ...ref } = input;
      return ctx.app.ops.managerExplorer.discardDeadMessage({
        ref,
        messageId,
        actorUserId: ctx.session.user.id,
      });
    }),

  /**
   * Every dead letter back to pending — one process, or the fleet when
   * `processName` is omitted (specs/ops/dead-letter-recovery.feature).
   */
  redriveDeadLetters: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.app.ops.managerExplorer.redriveDeadLetters({
        ...input,
        actorUserId: ctx.session.user.id,
      });
    }),

  /**
   * Every dead letter marked discarded; same scoping as the redrive.
   *
   * The fleet-wide form — no `processName` — crosses every tenant and cannot
   * be undone, since no redrive path selects a discarded row. It therefore
   * takes a typed confirmation, the same shape the blob-store delete uses:
   * the destructive breadth has to be reached deliberately, not by omitting
   * a field (best_practices/ops-dashboard.md).
   */
  discardDeadLetters: protectedProcedure
    .use(opsManagePermission)
    .input(
      z
        .object({
          processName: z.string().min(1).max(200).optional(),
          confirm: z.literal("DISCARD ALL").optional(),
        })
        .refine((input) => !!input.processName || input.confirm !== undefined, {
          message:
            "Discarding every process's dead letters requires an explicit confirmation",
          path: ["confirm"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.app.ops.managerExplorer.discardDeadLetters({
        ...(input.processName ? { processName: input.processName } : {}),
        actorUserId: ctx.session.user.id,
      });
    }),

  /** The message's failed attempts, oldest first — why a dead letter died. */
  listOutboxAttempts: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        outboxId: z.string().min(1).max(64),
        projectId: z.string().min(1).max(200),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.managerExplorer.getOutboxAttempts(input);
    }),

  processReleaseLapsedLease: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        processName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        processKey: z.string().min(1).max(500),
        messageId: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { messageId, ...ref } = input;
      return ctx.app.ops.managerExplorer.releaseLapsedLease({
        ref,
        messageId,
        actorUserId: ctx.session.user.id,
      });
    }),

  discoverAggregates: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        projectionNames: z.array(z.string()).min(1),
        since: z.string(),
        tenantIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;

      return ops.eventExplorer.discoverAggregates({
        projectionNames: input.projectionNames,
        since: input.since,
        tenantIds: input.tenantIds ?? [],
      });
    }),

  searchTenants: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ query: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.app.projects.searchByQuery({
        query: input.query,
      });
    }),

  dryRunReplay: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        projectionNames: z.array(z.string()).min(1),
        since: z.string(),
        tenantIds: z.array(z.string()),
        sampleSize: z.number().int().min(1).max(20).default(5),
      }),
    )
    .mutation(async ({ input }) => {
      return {
        status: "coming_soon" as const,
        message:
          "Dry run is not yet implemented. Full replay will process all aggregates.",
        projectionNames: input.projectionNames,
        sampleSize: input.sampleSize,
      };
    }),

  getReplayHistory: protectedProcedure.use(opsViewPermission).query(async ({ ctx }) => {
    const ops = ctx.app.ops;
    return ops.replay.getHistory();
  }),

  getReplayRun: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.replay.findHistoryEntry({ runId: input.runId });
    }),

  startReplay: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        projectionNames: z.array(z.string()).min(1),
        since: z.string(),
        tenantIds: z.array(z.string()).optional(),
        aggregateIds: z.array(z.string()).optional(),
        fullRebuild: z.boolean().optional(),
        description: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;

      const userName = ctx.session.user.name ?? ctx.session.user.email ?? "unknown";

      try {
        return await ops.replay.startReplay({
          projectionNames: input.projectionNames,
          since: input.since,
          tenantIds: input.tenantIds ?? [],
          aggregateIds: input.aggregateIds,
          fullRebuild: input.fullRebuild,
          description: input.description,
          userName,
        });
      } catch (err) {
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

  getReplayStatus: protectedProcedure.use(opsViewPermission).query(async ({ ctx }) => {
    const ops = ctx.app.ops;
    return ops.replay.getStatus();
  }),

  cancelReplay: protectedProcedure.use(opsManagePermission).mutation(async ({ ctx }) => {
    const ops = ctx.app.ops;
    return ops.replay.cancelReplay();
  }),

  listDlqGroups: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.listQueueDlqGroups(input);
    }),

  listAllDlqGroups: protectedProcedure.use(opsViewPermission).query(async ({ ctx }) => {
    const ops = ctx.app.ops;
    return ops.listAllQueueDlqGroups();
  }),

  listPausedKeys: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.listPausedQueueKeys(input);
    }),

  drainAllBlockedPreview: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        pipelineFilter: z.string().optional(),
        errorFilter: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.getQueueDrainPreview(input);
    }),

  moveToDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.moveQueueGroupToDlq(input);
    }),

  moveAllBlockedToDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        pipelineFilter: z.string().optional(),
        errorFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.moveAllBlockedQueueGroupsToDlq(input);
    }),

  replayFromDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.replayQueueGroupFromDlq(input);
    }),

  replayAllFromDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        pipelineFilter: z.string().optional(),
        errorFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.replayAllQueueGroupsFromDlq(input);
    }),

  /**
   * Redrive exactly the DLQ groups the operator's filter showed
   * (specs/ops/dead-letter-recovery.feature) — explicit ids, so the
   * confirmation and the act cover the same groups.
   */
  redriveManyFromDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupIds: z.array(z.string().min(1).max(500)).min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.app.ops.redriveQueueDlqGroups({
        ...input,
        requestedBy: ctx.session.user.id,
      });
    }),

  /**
   * Discard exactly the shown DLQ groups: their jobs never run again. The
   * audit row is the retained mark — the Redis entries expire regardless.
   */
  discardManyFromDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupIds: z.array(z.string().min(1).max(500)).min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.app.ops.discardQueueDlqGroups({
        ...input,
        requestedBy: ctx.session.user.id,
      });
    }),

  canaryRedrive: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        count: z.number().int().min(1).max(100).default(5),
        pipelineFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.canaryRedriveQueueDlq(input);
    }),

  canaryUnblock: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        count: z.number().int().min(1).max(100).default(5),
        pipelineFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.canaryUnblockQueueGroups(input);
    }),

  searchAggregates: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        query: z.string(),
        tenantId: z.string().optional(),
        sinceMs: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      const DEFAULT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
      const sinceMs = input.sinceMs ?? Date.now() - DEFAULT_LOOKBACK_MS;

      return ops.eventExplorer.searchAggregates({
        query: input.query,
        tenantIds: input.tenantId ? [input.tenantId] : [],
        sinceMs,
      });
    }),

  // Exposes (a) the 1-year DejaView search default and (b) the env-var-
  // derived hot-tier window for event_log so the DejaView UI can render
  // the banner under the search box. Cold-tier reads still work but get
  // quite some slower; the banner makes the bound visible up front.
  getEventLogSearchWindow: protectedProcedure.use(opsViewPermission).query(() => {
    const ttl = TABLE_TTL_CONFIG.find((c) => c.table === "event_log");
    return {
      searchLookbackDays: 365,
      hotTierDays: ttl ? resolveHotDays(ttl) : null,
      hotTierEnvVar: ttl?.envVar ?? null,
    };
  }),

  loadAggregateEvents: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        aggregateId: z.string(),
        tenantId: z.string(),
        limit: z.number().int().min(1).max(5000).default(500),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;
      return ops.eventExplorer.getAggregateEvents(input);
    }),

  computeProjectionState: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        aggregateId: z.string(),
        tenantId: z.string(),
        projectionName: z.string(),
        eventIndex: z.number().int().min(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      const ops = ctx.app.ops;

      const result = await ops.eventExplorer.computeProjectionState(input);
      if (!result.aggregateType) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Projection "${input.projectionName}" not found`,
        });
      }
      return result;
    }),

  // ---------------------------------------------------------------------------
  // Tenant anomalies (post-2026-05-11 incident follow-up).
  // ---------------------------------------------------------------------------

  /**
   * List currently-active tenant anomalies (rate breaker + structural
   * fingerprint loops). Sorted with hard-tier first.
   */
  listAnomalies: protectedProcedure.use(opsViewPermission).query(async ({ ctx }) => {
    const anomalies = await ctx.app.ops.listAnomalies();
    return { anomalies };
  }),

  /**
   * Dismiss an active anomaly manually. The next detector tick may
   * resurface it if conditions are still met — this is just an operator
   * ack to stop the badge from blinking.
   */
  dismissAnomaly: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        tenantId: z.string().min(1),
        kind: z.enum(["rate_breaker"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dismissed = await ctx.app.ops.dismissAnomaly(input);
      return { dismissed };
    }),

  /**
   * Lists every registered feature flag plus any orphaned postgres
   * rows. Operators use this to see the source of truth for each flag
   * (registry default vs postgres override vs env override) before
   * flipping anything.
   *
   * Read-only: no PostHog calls happen on this path either, so opening
   * the page does not cost a flag call.
   */
  listFeatureFlags: protectedProcedure
    .use(opsViewPermission)
    .output(operatorFeatureFlagCatalogueSchema)
    .query(async ({ ctx }) => ctx.app.featureFlags.listOperatorCatalogue()),

  setFeatureFlag: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        key: z.string().min(1).max(200),
        enabled: z.boolean(),
      }),
    )
    .output(okOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const isExplicitKey = listFeatureFlags().some((f) => f.key === input.key);
      if (!isExplicitKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown feature flag key: ${input.key}`,
        });
      }
      await ctx.app.featureFlags.setEnabled({
        key: input.key,
        enabled: input.enabled,
        lastEditedBy: ctx.session.user.id,
      });
      return { ok: true };
    }),

  setFeatureFlagRules: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        key: z.string().min(1).max(200),
        // Write-time only — the read path's `parseRules` must keep accepting
        // whatever is already stored, so this refinement lives here and not on
        // the shared schema. A blank id can never match any context (matching
        // is exact string equality), so a rule carrying one is a dead rule the
        // operator believes is live.
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
              message:
                "A targeting rule's project/organization id must not be blank or padded",
            },
          ),
      }),
    )
    .output(okOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const isExplicitKey = listFeatureFlags().some((f) => f.key === input.key);
      if (!isExplicitKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown feature flag key: ${input.key}`,
        });
      }
      await ctx.app.featureFlags.setRules({
        key: input.key,
        rules: input.rules,
        lastEditedBy: ctx.session.user.id,
      });
      return { ok: true };
    }),

  clearFeatureFlag: protectedProcedure
    .use(opsManagePermission)
    .input(z.object({ key: z.string().min(1).max(200) }))
    .output(okOutputSchema)
    .mutation(async ({ ctx, input }) => {
      // Deliberately permissive: listFeatureFlags surfaces orphan rows
      // (DB keys that no longer match the registry or pipeline graph)
      // so operators can delete them. Validating the key here would
      // break that cleanup path.
      await ctx.app.featureFlags.clearStoredFlag({
        key: input.key,
        lastEditedBy: ctx.session.user.id,
      });
      return { ok: true };
    }),

  // ---------------------------------------------------------------------------
  // Blob store (group queue content-addressed payloads)
  //
  // Reads are ops:view. Everything that can destroy a payload additionally
  // requires a non-impersonated session and a typed confirmation — see
  // `requireDestructiveOpsAuth`.
  // ---------------------------------------------------------------------------

  listBlobQueues: protectedProcedure.use(opsViewPermission).query(async ({ ctx }) => {
    return ctx.app.ops.listBlobQueues();
  }),

  getBlobStoreStats: protectedProcedure.use(opsViewPermission).query(async ({ ctx }) => {
    return ctx.app.ops.getBlobStoreStats();
  }),

  listBlobs: protectedProcedure
    .use(opsViewPermission)
    .input(listBlobsInputSchema)
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.listBlobs(input);
    }),

  getBlob: protectedProcedure
    .use(opsViewPermission)
    .input(getBlobInputSchema)
    .query(async ({ input, ctx }) => {
      return ctx.app.ops.tryGetBlob(input);
    }),

  runBlobCleanup: protectedProcedure
    .use(opsManagePermission)
    .input(
      runBlobCleanupInputSchema.extend({
        // Typed confirmation, required only for the destructive form. A sweep
        // that reclaims is not something to reach by mis-clicking a toggle.
        confirm: z.literal("RECLAIM").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.dryRun) {
        requireDestructiveOpsAuth(ctx, input.confirm);
      }
      return ctx.app.ops.runBlobCleanup({
        dryRun: input.dryRun,
        // Opaque id, not email: the audit trail must trace the actor without
        // carrying PII into the log stream.
        requestedBy: ctx.session.user.id,
      });
    }),

  deleteBlob: protectedProcedure
    .use(opsManagePermission)
    .input(deleteBlobInputSchema.extend({ confirm: z.literal("DELETE") }))
    .mutation(async ({ ctx, input }) => {
      requireDestructiveOpsAuth(ctx, input.confirm);
      return ctx.app.ops.deleteBlob({
        queueName: input.queueName,
        projectId: input.projectId,
        hash: input.hash,
        // Opaque id, not email: the audit trail must trace the actor without
        // carrying PII into the log stream.
        requestedBy: ctx.session.user.id,
      });
    }),

  /**
   * The in-place system migrations (@langwatch/system-migrations), per
   * migration: status rollup plus the tenants needing attention - held
   * (`migrated`, parity disagreements in the report) and `parked` (errored,
   * retried next pass). Finalized tenants are a count, not a listing.
   */
  listSystemMigrations: protectedProcedure
    .use(opsViewPermission)
    .query(() => systemMigrationsService.getOverview()),

  /**
   * The cloud rollout's enrollment listing: which organizations are enrolled
   * for which migrations, with the names the operator recognizes. Carries
   * `isSaaS` so the page can say honestly that a self-hosted installation
   * has nothing to enroll.
   */
  listMigrationEnrollments: protectedProcedure.use(opsViewPermission).query(({ ctx }) =>
    systemMigrationsService.getEnrollments({
      requestedBy: ctx.session.user.id,
    }),
  ),

  /**
   * The organization lookup behind the page's pickers: enroll, targeted run
   * and rollback all act on an organization found by name or exact id.
   */
  searchMigrationOrganizations: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ query: z.string().max(200) }))
    .query(({ input }) =>
      systemMigrationsService.searchOrganizations({ query: input.query }),
    ),

  /**
   * Enroll one organization for one registered migration. Takes effect on
   * the next pass - enrollment is read fresh each time. The service refuses
   * duplicates, unknown migrations, unknown organizations, and any
   * enrollment on a self-hosted installation, each with a handled error the
   * page renders.
   */
  enrollMigrationTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        organizationId: z.string().min(1).max(200),
        migrationName: z.string().min(1).max(200),
        // Typed confirmation for the cutover migration, same reasoning as
        // the rollback's: enrolling an organization for cutover is what lets
        // the next pass flip which tables answer every permission check for
        // it.
        confirm: z.literal("ENROLL").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The preparation migrations are behavior-neutral (backfill and
      // genesis change nothing about who decides); the cutover has the
      // rollback's blast radius, so it takes the rollback's guard. Which is
      // which comes from the migration's own declaration, so this gate and
      // the page that asks for the confirmation cannot drift apart.
      if (
        systemMigrationsService.requiresOperatorConfirmation({
          migrationName: input.migrationName,
        })
      ) {
        requireDestructiveOpsAuth(ctx, input.confirm);
      }
      await systemMigrationsService.enroll({
        organizationId: input.organizationId,
        migrationName: input.migrationName,
        actorUserId: ctx.session.user.id,
      });
      return { enrolled: true };
    }),

  /**
   * Enroll a sampled cohort of organizations for one migration in a single
   * action. The service draws the sample from organizations not yet
   * enrolled, excluding enterprise plans and private-dataplane routes by
   * data rather than by any list in code. The cutover keeps its typed
   * confirmation: a cohort of cutovers is the same flip N times over.
   */
  enrollMigrationCohort: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        migrationName: z.string().min(1).max(200),
        sampleSize: z.number().int().min(1).max(1000),
        confirm: z.literal("ENROLL").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        systemMigrationsService.requiresOperatorConfirmation({
          migrationName: input.migrationName,
        })
      ) {
        requireDestructiveOpsAuth(ctx, input.confirm);
      }
      return systemMigrationsService.enrollCohort({
        migrationName: input.migrationName,
        sampleSize: input.sampleSize,
        actorUserId: ctx.session.user.id,
      });
    }),

  /**
   * Withdraw an enrollment: later passes stop processing the organization
   * for that migration. State already recorded stays exactly as it is -
   * pausing the rollout is this action's whole job; undoing it is the
   * rollback's.
   */
  withdrawMigrationTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        organizationId: z.string().min(1).max(200),
        migrationName: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await systemMigrationsService.withdraw({
        organizationId: input.organizationId,
        migrationName: input.migrationName,
        actorUserId: ctx.session.user.id,
      });
      return { withdrawn: true };
    }),

  /**
   * Run one migration for one organization now. Awaited: the operator asked
   * about one organization and gets the status it ended the run in. The
   * service refuses unknown migrations, unknown organizations, unenrolled
   * organizations (cloud) and an organization whose claim another pass
   * already holds, each with a handled error the page renders.
   */
  runSystemMigrationForOrganization: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        organizationId: z.string().min(1).max(200),
        migrationName: z.string().min(1).max(200),
        // Typed confirmation for the cutover migration - a targeted cutover
        // run is exactly the flip the enrollment confirmation guards.
        confirm: z.literal("RUN").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        systemMigrationsService.requiresOperatorConfirmation({
          migrationName: input.migrationName,
        })
      ) {
        requireDestructiveOpsAuth(ctx, input.confirm);
      }
      return systemMigrationsService.runForOrganization({
        organizationId: input.organizationId,
        migrationName: input.migrationName,
        actorUserId: ctx.session.user.id,
      });
    }),

  /**
   * Kick a migration pass now instead of waiting for the next worker boot -
   * the lever for processing a fresh enrollment right away or re-verifying
   * held tenants after remediation. Fire-and-forget: per-organization claims
   * already keep two passes off the same organization, so the worst case for
   * a double click is a pass that finds everything claimed and does nothing.
   */
  runSystemMigrationPass: protectedProcedure.use(opsManagePermission).mutation(() => {
    systemMigrationsService.startPass();
    return { started: true };
  }),

  assertSystemMigrationLegacyWritersDrained: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        migrationName: z.string().min(1).max(200),
        tenantId: z.string().min(1).max(200),
        minimumWriterGeneration: z.string().min(1).max(200),
        confirm: z.literal("DRAIN LEGACY WRITERS").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireDestructiveOpsAuth(ctx, input.confirm);
      await systemMigrationsService.assertLegacyWritersDrained({
        migrationName: input.migrationName,
        tenantId: input.tenantId,
        minimumWriterGeneration: input.minimumWriterGeneration,
        actorUserId: ctx.session.user.id,
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
  rollBackSystemMigrationTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        migrationName: z.string().min(1).max(200),
        tenantId: z.string().min(1).max(200),
        // Typed confirmation, same reasoning as `deleteBlob`.
        confirm: z.literal("ROLL BACK").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Same posture as the blob-store writes: this procedure is callable
      // without the dialog, and it decides which tables answer every
      // permission check for an entire organization.
      requireDestructiveOpsAuth(ctx, input.confirm);
      await systemMigrationsService.rollBack({
        migrationName: input.migrationName,
        tenantId: input.tenantId,
        actorUserId: ctx.session.user.id,
      });
      return { rolledBack: true };
    }),
});
