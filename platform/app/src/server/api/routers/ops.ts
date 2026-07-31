import { on } from "node:events";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { checkOpsPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { DASHBOARD_EVENT } from "~/server/app-layer/ops/metrics-collector";
import {
  type DashboardData,
  OPS_BLOB_SORTS,
} from "~/server/app-layer/ops/types";
import {
  resolveHotDays,
  TABLE_TTL_CONFIG,
} from "~/server/clickhouse/ttlReconciler";
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
import { AnomalyStateStore } from "~/server/observability/anomalyState";
import { connection } from "~/server/redis";

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

/**
 * The extra gate on anything that can destroy a queue payload.
 *
 * `ops:manage` already resolves through the admin allow-list, but it is not
 * enough on its own here for two reasons. It is inherited by an impersonation
 * session — `resolveOpsScope` deliberately falls back to the impersonator's own
 * grant — and "acting as" another user is the wrong posture for irreversible
 * infrastructure surgery, because the audit trail names the impersonated
 * account. And deleting a blob is unrecoverable and silent at the queue level:
 * the job that referenced it completes without its handler ever running, so
 * there is no failure for anyone to notice. A typed confirmation makes that a
 * deliberate act rather than a mis-click.
 */
function requireBlobStoreWriteAuth(
  ctx: {
    session: { user: { impersonator?: { email?: string | null } | null } };
  },
  confirm: string | undefined,
) {
  if (ctx.session.user.impersonator) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Blob store changes cannot be made from an impersonated session. Sign in directly to continue.",
    });
  }
  if (!confirm) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This action needs to be confirmed before it can run",
    });
  }
}

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

  getDashboardSnapshot: protectedProcedure.use(opsViewPermission).query(() => {
    const ops = getApp().ops;
    if (!ops?.metricsCollector) return null;
    return ops.metricsCollector.getDashboardData();
  }),

  /**
   * Cheap counts-only query for the global ops badge in the main menu.
   * Returns just the parked-lane count the badge renders, bypassing the full
   * dashboard aggregation. Use this for always-on polling; reach for
   * `getDashboardSnapshot` only on the ops route itself.
   */
  getBadgeCounts: protectedProcedure.use(opsViewPermission).query(() => {
    const ops = getApp().ops;
    if (!ops?.metricsCollector) {
      return { parkedCount: 0, computedAt: new Date() };
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

  listScheduledJobs: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }))
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.scheduler.listScheduledJobs({ limit: input.limit });
    }),

  // ---------------------------------------------------------------------------
  // Lanes (ADR-108's dispatch plane).
  //
  // A lane is the unit the plane serialises on, so it is the unit an operator
  // inspects and recovers. Depth, lease and park state are lane keys, so they
  // are answerable here. The old plane's DLQ, blocked set and per-pipeline /
  // per-tenant pause keys are not: they were removed with it, and there is no
  // key left to read or write for any of them.
  // ---------------------------------------------------------------------------

  listLanes: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        laneKind: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.getLanes(input);
    }),

  getLaneDetail: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        laneKind: z.string(),
        laneId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      const lane = await ops.queues.getLaneDetail(input);
      if (!lane) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Lane "${input.laneId}" not found among the ${input.laneKind} lanes`,
        });
      }
      return lane;
    }),

  getLaneJobs: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        laneId: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.getLaneJobs(input);
    }),

  unparkLane: protectedProcedure
    .use(opsManagePermission)
    .input(z.object({ laneId: z.string() }))
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unparkLane(input);
    }),

  unparkAll: protectedProcedure
    .use(opsManagePermission)
    .input(z.object({ laneKind: z.string() }))
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unparkAll(input);
    }),

  drainLane: protectedProcedure
    .use(opsManagePermission)
    .input(z.object({ laneId: z.string() }))
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.drainLane(input);
    }),

  drainTenant: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        tenantId: z.string().min(1),
        // Optional substring filter on the lane id. Honest substring semantics
        // — what the operator sees in the Lanes table is what they match on.
        laneIdContains: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.drainTenant(input);
    }),

  /**
   * The registered pipelines' projections and event subscribers. There is no
   * introspection module (ADR-108 §1) — the registry itself is the surface,
   * so this reads it directly and reshapes it for the Deja View / replay UIs.
   */
  listProjections: protectedProcedure.use(opsViewPermission).query(() => {
    const registered = getApp().eventSourcing?.registry.all() ?? [];
    return {
      projections: registered.flatMap(({ pipeline, aggregateType }) => [
        ...Object.values(pipeline.folds).map((fold) => ({
          projectionName: fold.name,
          pipelineName: pipeline.name,
          aggregateType,
          kind: "fold" as const,
        })),
        ...Object.values(pipeline.maps).map((map) => ({
          projectionName: map.name,
          pipelineName: pipeline.name,
          aggregateType,
          kind: "map" as const,
        })),
      ]),
      eventSubscribers: registered.flatMap(({ pipeline, aggregateType }) =>
        Object.values(pipeline.subscribers).map((subscriber) => ({
          subscriberName: subscriber.name,
          pipelineName: pipeline.name,
          aggregateType,
          eventTypes: subscriber.eventTypes,
        })),
      ),
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
    .query(async ({ input }) => {
      return requireOps().managerExplorer.getForAggregate({
        aggregateType: input.aggregateType,
        projectId: input.tenantId,
        aggregateId: input.aggregateId,
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

  getReplayStatus: protectedProcedure.use(opsViewPermission).query(async () => {
    const ops = requireOps();
    return ops.replay.getStatus();
  }),

  cancelReplay: protectedProcedure
    .use(opsManagePermission)
    .mutation(async () => {
      const ops = requireOps();
      return ops.replay.cancelReplay();
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
    .query(async ({ input }) => {
      const ops = requireOps();
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
  getEventLogSearchWindow: protectedProcedure
    .use(opsViewPermission)
    .query(() => {
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
  listAnomalies: protectedProcedure.use(opsViewPermission).query(async () => {
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

      // Stored postgres rows with no explicit registry entry: orphans from
      // removed components, or keys we no longer recognize. Surfaced so
      // operators can clean them up.
      const orphanRows = stored
        .filter((s) => !explicitKeys.has(s.key))
        .map((s) => {
          const def = resolveFlagDefinition(s.key);
          const envOverride = checkFlagEnvOverride(s.key, def?.legacyEnvVar);
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
            description:
              def?.description ??
              "Orphaned postgres flag row (no longer registered).",
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
        flags: [...explicitRows, ...orphanRows],
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
      // Restrict writes to explicit registry entries. Family-prefix matching
      // alone is too permissive — an unregistered key passes
      // `resolveFlagDefinition`, so a typo would create an orphan row that
      // never affects anything.
      if (!listFeatureFlags().some((f) => f.key === input.key)) {
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
      if (!listFeatureFlags().some((f) => f.key === input.key)) {
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

  // ---------------------------------------------------------------------------
  // Blob store (group queue content-addressed payloads)
  //
  // Reads are ops:view. Everything that can destroy a payload additionally
  // requires a non-impersonated session and a typed confirmation — see
  // `requireBlobStoreWriteAuth`.
  // ---------------------------------------------------------------------------

  listBlobQueues: protectedProcedure.use(opsViewPermission).query(async () => {
    return requireOps().blobStore.getQueueNames();
  }),

  getBlobStoreStats: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      return requireOps().blobStore.getStats();
    }),

  listBlobs: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string().min(1).max(200),
        cursor: z.string().max(4000).nullish(),
        limit: z.number().int().min(1).max(200).default(50),
        projectId: z.string().max(200).nullish(),
        sort: z.enum(OPS_BLOB_SORTS).default("largest"),
      }),
    )
    .query(async ({ input }) => {
      return requireOps().blobStore.getBlobs(input);
    }),

  getBlob: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        hash: z.string().min(1).max(200),
      }),
    )
    .query(async ({ input }) => {
      return requireOps().blobStore.getBlobById(input);
    }),

  runBlobCleanup: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        dryRun: z.boolean().default(true),
        // Typed confirmation, required only for the destructive form. A sweep
        // that reclaims is not something to reach by mis-clicking a toggle.
        confirm: z.literal("RECLAIM").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.dryRun) {
        requireBlobStoreWriteAuth(ctx, input.confirm);
      }
      return requireOps().blobStore.runCleanup({
        dryRun: input.dryRun,
        // Opaque id, not email: the audit trail must trace the actor without
        // carrying PII into the log stream.
        requestedBy: ctx.session.user.id,
      });
    }),

  deleteBlob: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
        hash: z.string().min(1).max(200),
        confirm: z.literal("DELETE"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireBlobStoreWriteAuth(ctx, input.confirm);
      return requireOps().blobStore.deleteBlob({
        queueName: input.queueName,
        projectId: input.projectId,
        hash: input.hash,
        // Opaque id, not email: the audit trail must trace the actor without
        // carrying PII into the log stream.
        requestedBy: ctx.session.user.id,
      });
    }),
});
