import { on } from "node:events";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOpsPermission } from "~/server/api/rbac";
import { getApp } from "~/server/app-layer/app";
import { DASHBOARD_EVENT } from "~/server/app-layer/ops/metrics-collector";
import type { DashboardData } from "~/server/app-layer/ops/types";
import {
  getKillSwitchDescriptors,
  getProjectionMetadata,
  getReactorMetadata,
} from "~/server/event-sourcing/pipelineRegistry";
import { AnomalyStateStore } from "~/server/observability/anomalyState";
import { connection } from "~/server/redis";
import {
  getFeatureFlagStore,
  listFeatureFlagFamilies,
  listFeatureFlags,
  resolveFlagDefinition,
} from "~/server/featureFlag";
import { checkFlagEnvOverride } from "~/server/featureFlag/envOverride";
import {
  featureFlagRulesSchema,
  resolveEffectiveForListing,
} from "~/server/featureFlag/rules";

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

function requireOps() {
  const ops = getApp().ops;
  if (!ops) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Ops module is not available",
    });
  }
  return ops;
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

  getDashboardSnapshot: protectedProcedure
    .use(opsViewPermission)
    .query(() => {
      const ops = getApp().ops;
      if (!ops?.metricsCollector) return null;
      return ops.metricsCollector.getDashboardData();
    }),

  /**
   * Cheap counts-only query for the global ops badge in the main menu.
   * Returns just the two integers the badge renders (blocked groups +
   * DLQ jobs), bypassing the full dashboard aggregation. Use this for
   * always-on polling; reach for `getDashboardSnapshot` only on the
   * ops route itself.
   */
  getBadgeCounts: protectedProcedure
    .use(opsViewPermission)
    .query(() => {
      const ops = getApp().ops;
      if (!ops?.metricsCollector) {
        return { blockedCount: 0, dlqCount: 0 };
      }
      return ops.metricsCollector.getBadgeCounts();
    }),

  dashboardStream: protectedProcedure
    .use(opsViewPermission)
    .subscription(async function* (opts) {
      const collector = getApp().ops?.metricsCollector;
      if (!collector) return;

      // Yield the current snapshot immediately so the client doesn't have
      // to wait for the next broadcast tick before rendering.
      yield collector.getDashboardData();

      for await (const [data] of on(collector.getEmitter(), DASHBOARD_EVENT, {
        // @ts-expect-error - signal is not typed
        signal: opts.signal,
      })) {
        yield data as DashboardData;
      }
    }),

  listQueues: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.queues.getQueues();
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
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.getGroups(input);
    }),

  getGroupDetail: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      const group = await ops.queues.getGroupDetail(input);
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Group "${input.groupId}" not found in queue "${input.queueName}"`,
        });
      }
      return group;
    }),

  getBlockedSummary: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.queues.getBlockedSummary();
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
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.getGroupJobs(input);
    }),

  unblockGroup: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unblockGroup(input);
    }),

  unblockAll: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unblockAll(input);
    }),

  drainGroup: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.drainGroup(input);
    }),

  pausePipeline: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        key: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.pausePipeline(input);
    }),

  unpausePipeline: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        key: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unpausePipeline(input);
    }),

  pauseTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        tenantId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.pauseTenant(input);
    }),

  unpauseTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        tenantId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unpauseTenant(input);
    }),

  listPausedTenants: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ queueName: z.string() }))
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.listPausedTenants(input);
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
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.drainTenant(input);
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
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.retryBlocked(input);
    }),

  listProjections: protectedProcedure
    .use(opsViewPermission)
    .query(() => {
      return {
        projections: getProjectionMetadata(),
        reactors: getReactorMetadata(),
      };
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
    .query(async ({ input }) => {
      const ops = requireOps();

      return ops.eventExplorer.discoverAggregates({
        projectionNames: input.projectionNames,
        since: input.since,
        tenantIds: input.tenantIds ?? [],
      });
    }),

  searchTenants: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return getApp().projects.searchByQuery({
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

  getReplayHistory: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.replay.getHistory();
    }),

  getReplayRun: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ runId: z.string() }))
    .query(async ({ input }) => {
      const ops = requireOps();
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
        description: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = requireOps();

      const userName =
        ctx.session.user.name ?? ctx.session.user.email ?? "unknown";

      try {
        return await ops.replay.startReplay({
          projectionNames: input.projectionNames,
          since: input.since,
          tenantIds: input.tenantIds ?? [],
          aggregateIds: input.aggregateIds,
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

  getReplayStatus: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.replay.getStatus();
    }),

  cancelReplay: protectedProcedure
    .use(opsManagePermission)
    .mutation(async () => {
      const ops = requireOps();
      return ops.replay.cancelReplay();
    }),

  listDlqGroups: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.listDlqGroups(input);
    }),

  listAllDlqGroups: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.queues.getAllDlqGroups();
    }),

  listPausedKeys: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.listPausedKeys(input);
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
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.getDrainPreview(input);
    }),

  moveToDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.moveToDlq(input);
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
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.moveAllBlockedToDlq(input);
    }),

  replayFromDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.replayFromDlq(input);
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
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.replayAllFromDlq(input);
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
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.canaryRedrive(input);
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
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.canaryUnblock(input);
    }),

  searchAggregates: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        query: z.string(),
        tenantId: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();

      return ops.eventExplorer.searchAggregates({
        query: input.query,
        tenantIds: input.tenantId ? [input.tenantId] : [],
      });
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
    .query(async ({ input }) => {
      const ops = requireOps();
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
    .query(async ({ input }) => {
      const ops = requireOps();

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
  listAnomalies: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      if (!connection) return { anomalies: [] };
      const store = new AnomalyStateStore(connection);
      const anomalies = await store.list();
      anomalies.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier === "hard" ? -1 : 1;
        return b.triggeredAt - a.triggeredAt;
      });
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
    .mutation(async ({ input }) => {
      if (!connection) return { dismissed: false };
      const store = new AnomalyStateStore(connection);
      await store.clear(input.tenantId, input.kind);
      return { dismissed: true };
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
    .query(async () => {
      const store = getFeatureFlagStore();
      const stored = await store.listAll();
      const explicit = listFeatureFlags();
      const families = listFeatureFlagFamilies();
      const explicitKeys = new Set(explicit.map((e) => e.key));

      const explicitRows = explicit.map((def) => {
        const row = stored.find((s) => s.key === def.key);
        const envOverride = checkFlagEnvOverride(def.key, def.legacyEnvVar);
        const effective = resolveEffectiveForListing({
          envOverride: envOverride ?? null,
          rules: row?.rules ?? [],
          rowEnabled: row?.enabled ?? null,
          registryDefault: def.defaultValue,
        });
        return {
          key: def.key,
          scope: def.scope,
          defaultValue: def.defaultValue,
          description: def.description,
          family: def.family ?? null,
          storedValue: row?.enabled ?? null,
          rules: row?.rules ?? [],
          envOverride: envOverride ?? null,
          effective,
          lastEditedBy: row?.lastEditedBy ?? null,
          updatedAt: row?.updatedAt ?? null,
        };
      });

      // Pre-seed every generated kill-switch key from the live pipeline
      // graph. Operators see the full set of toggleable es-* switches
      // even before anyone has flipped them in postgres, which was the
      // whole point of moving them off PostHog: discoverability.
      const generatedKillSwitches = getKillSwitchDescriptors();

      // Merge: combine generated descriptors with any postgres rows
      // that don't have an explicit registry entry. Postgres value wins
      // the row but the descriptor provides the metadata.
      const familyKeysSeen = new Set<string>();
      const familyRows = generatedKillSwitches.map((desc) => {
        familyKeysSeen.add(desc.key);
        const row = stored.find((s) => s.key === desc.key);
        const def = resolveFlagDefinition(desc.key);
        const envOverride = checkFlagEnvOverride(desc.key, def?.legacyEnvVar);
        const effective = resolveEffectiveForListing({
          envOverride: envOverride ?? null,
          rules: row?.rules ?? [],
          rowEnabled: row?.enabled ?? null,
          registryDefault: def?.defaultValue ?? false,
        });
        return {
          key: desc.key,
          scope: def?.scope ?? "SYSTEM",
          defaultValue: def?.defaultValue ?? false,
          description: def?.description
            ? `${def.description} (${desc.pipelineName}: ${desc.componentType} ${desc.componentName})`
            : `Pipeline ${desc.pipelineName} ${desc.componentType} ${desc.componentName}.`,
          family: def?.family ?? null,
          storedValue: row?.enabled ?? null,
          rules: row?.rules ?? [],
          envOverride: envOverride ?? null,
          effective,
          lastEditedBy: row?.lastEditedBy ?? null,
          updatedAt: row?.updatedAt ?? null,
        };
      });

      // Stored postgres rows that match neither an explicit registry
      // entry nor a generated descriptor. Either orphans from removed
      // pipeline components or rows for keys we no longer recognize;
      // surface them so operators can clean up.
      const orphanRows = stored
        .filter(
          (s) => !explicitKeys.has(s.key) && !familyKeysSeen.has(s.key),
        )
        .map((s) => {
          const def = resolveFlagDefinition(s.key);
          const envOverride = checkFlagEnvOverride(
            s.key,
            def?.legacyEnvVar,
          );
          const effective = resolveEffectiveForListing({
            envOverride: envOverride ?? null,
            rules: s.rules,
            rowEnabled: s.enabled,
            registryDefault: def?.defaultValue ?? false,
          });
          return {
            key: s.key,
            scope: def?.scope ?? "SYSTEM",
            defaultValue: def?.defaultValue ?? false,
            description: def?.description ?? "Orphaned postgres flag row (no longer registered).",
            family: def?.family ?? null,
            storedValue: s.enabled,
            rules: s.rules,
            envOverride: envOverride ?? null,
            effective,
            lastEditedBy: s.lastEditedBy,
            updatedAt: s.updatedAt,
          };
        });

      return {
        flags: [...explicitRows, ...familyRows, ...orphanRows],
        families: families.map((f) => ({
          family: f.family,
          keyPrefix: f.keyPrefix,
          scope: f.scope,
          defaultValue: f.defaultValue,
          description: f.description,
        })),
      };
    }),

  setFeatureFlag: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        key: z.string().min(1).max(200),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Restrict writes to keys the system actively knows about:
      // explicit registry entries or kill-switch descriptors currently
      // advertised by the live pipeline graph. Family-prefix matching
      // alone is too permissive — `es-foo-bar-killswitch` passes
      // `resolveFlagDefinition` even with no pipeline component on the
      // other end, so a typo would create an orphan row that never
      // affects anything.
      const isExplicitKey = listFeatureFlags().some(
        (f) => f.key === input.key,
      );
      const isLiveKillSwitch = getKillSwitchDescriptors().some(
        (d) => d.key === input.key,
      );
      if (!isExplicitKey && !isLiveKillSwitch) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown feature flag key: ${input.key}`,
        });
      }
      await getFeatureFlagStore().set(
        input.key,
        input.enabled,
        ctx.session.user.id,
      );
      return { ok: true };
    }),

  setFeatureFlagRules: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        key: z.string().min(1).max(200),
        rules: featureFlagRulesSchema.max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const isExplicitKey = listFeatureFlags().some(
        (f) => f.key === input.key,
      );
      const isLiveKillSwitch = getKillSwitchDescriptors().some(
        (d) => d.key === input.key,
      );
      if (!isExplicitKey && !isLiveKillSwitch) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown feature flag key: ${input.key}`,
        });
      }
      await getFeatureFlagStore().setRules(
        input.key,
        input.rules,
        ctx.session.user.id,
      );
      return { ok: true };
    }),

  clearFeatureFlag: protectedProcedure
    .use(opsManagePermission)
    .input(z.object({ key: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      // Deliberately permissive: listFeatureFlags surfaces orphan rows
      // (DB keys that no longer match the registry or pipeline graph)
      // so operators can delete them. Validating the key here would
      // break that cleanup path.
      await getFeatureFlagStore().clear(input.key, ctx.session.user.id);
      return { ok: true };
    }),
});
