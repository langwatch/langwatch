/**
 * Phase 6 source-awareness tests for the graph-trigger heartbeat.
 *
 * The heartbeat must group candidate triggers per (project, source) and
 * issue at most one batched recency query per (project, source) per tick.
 * Trace-source triggers query `trace_analytics`; eval-source triggers
 * query `evaluation_analytics`.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag/types";
import type { AnalyticsMetricSource } from "~/server/app-layer/analytics/routing/field-availability";
import type { TriggerSummary } from "../repositories/trigger.repository";
import type { TriggerService } from "../trigger.service";
import {
  decideGraphTriggerHeartbeat,
  type GraphTriggerHeartbeatDeps,
  type HeartbeatCandidateSources,
} from "../graph-trigger-heartbeat";

const PROJECT = "proj-mixed";
const TRIGGER_TRACE = "trig-trace";
const TRIGGER_EVAL = "trig-eval";

function makeTrigger(
  id: string,
  customGraphId: string,
  actionParams: Record<string, unknown>,
): TriggerSummary {
  return {
    id,
    projectId: PROJECT,
    name: id,
    action: TriggerAction.SEND_EMAIL,
    actionParams,
    filters: {},
    alertType: null,
    message: null,
    customGraphId,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
  };
}

function makeTriggersService(perProject: Record<string, TriggerSummary[]>): TriggerService {
  return {
    getActiveTraceTriggersForProject: vi.fn(async () => []),
    getActiveGraphTriggersForProject: vi.fn(
      async (projectId: string) => perProject[projectId] ?? [],
    ),
    claimSend: vi.fn(),
    isSendClaimed: vi.fn(),
    updateLastRunAt: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as TriggerService;
}

function makeFlagsAllOn(): FeatureFlagServiceInterface {
  return {
    isEnabled: vi.fn(async () => true),
  };
}

function makeSources(overrides: {
  graphProjects?: string[];
  openSentProjects?: Set<string>;
}): HeartbeatCandidateSources {
  return {
    loadProjectsWithGraphTriggers: async () => overrides.graphProjects ?? [],
    loadProjectsWithOpenGraphTriggerSent: async () =>
      overrides.openSentProjects ?? new Set<string>(),
  };
}

function makePrismaStub() {
  return {
    triggerSent: {
      findMany: vi.fn(async () => [] as Array<{ triggerId: string }>),
    },
  };
}

interface QueryCall {
  query: string;
  tenantId: string;
}

function makeClickHouseStub(): {
  client: ClickHouseClient;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(
      async (params: {
        query: string;
        query_params: { tenantId: string };
      }) => {
        calls.push({ query: params.query, tenantId: params.query_params.tenantId });
        // Return null recency so EVERY candidate enqueues (the test cares
        // about query routing, not enqueue filtering).
        return { json: async () => [{ lastMs: null }] };
      },
    ),
  } as unknown as ClickHouseClient;
  return { client, calls };
}

describe("decideGraphTriggerHeartbeat source-awareness (ADR-034 Phase 6)", () => {
  const now = new Date("2026-06-20T12:00:00Z");
  let prismaStub: ReturnType<typeof makePrismaStub>;
  let clickHouseStub: ReturnType<typeof makeClickHouseStub>;

  beforeEach(() => {
    prismaStub = makePrismaStub();
    clickHouseStub = makeClickHouseStub();
  });

  describe("given a project with one trace-source and one eval-source graph trigger", () => {
    it("issues one query against trace_analytics and one against evaluation_analytics", async () => {
      // Both triggers are no-data shapes (operator: lt, threshold: 1) so
      // both qualify as candidates.
      const noDataParams = {
        operator: "lt",
        threshold: 1,
        timePeriod: 60,
        seriesName: "0/x/y",
      };
      const triggers = makeTriggersService({
        [PROJECT]: [
          makeTrigger(TRIGGER_TRACE, "graph-trace", noDataParams),
          makeTrigger(TRIGGER_EVAL, "graph-eval", noDataParams),
        ],
      });

      const sourceByTrigger: Record<string, AnalyticsMetricSource> = {
        [TRIGGER_TRACE]: "trace",
        [TRIGGER_EVAL]: "evaluation",
      };

      const deps: GraphTriggerHeartbeatDeps = {
        triggers,
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => clickHouseStub.client,
        featureFlagService: makeFlagsAllOn(),
        lookupTriggerSource: async ({ triggerId }) => sourceByTrigger[triggerId],
      };

      const requests = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT] }),
        now,
      });

      // Both triggers enqueued (recency null → no skip).
      expect(requests).toHaveLength(2);

      // Exactly two queries — one per source.
      expect(clickHouseStub.calls).toHaveLength(2);
      const traceCall = clickHouseStub.calls.find((c) =>
        c.query.includes("FROM trace_analytics"),
      );
      const evalCall = clickHouseStub.calls.find((c) =>
        c.query.includes("FROM evaluation_analytics"),
      );
      expect(traceCall).toBeDefined();
      expect(evalCall).toBeDefined();
      expect(traceCall?.tenantId).toBe(PROJECT);
      expect(evalCall?.tenantId).toBe(PROJECT);
    });
  });

  describe("given a project with only an eval-source trigger", () => {
    it("issues exactly one query against evaluation_analytics, none against trace_analytics", async () => {
      const noDataParams = {
        operator: "lt",
        threshold: 1,
        timePeriod: 60,
        seriesName: "0/x/y",
      };
      const triggers = makeTriggersService({
        [PROJECT]: [makeTrigger(TRIGGER_EVAL, "graph-eval", noDataParams)],
      });

      const deps: GraphTriggerHeartbeatDeps = {
        triggers,
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => clickHouseStub.client,
        featureFlagService: makeFlagsAllOn(),
        lookupTriggerSource: async () => "evaluation" as const,
      };

      const requests = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT] }),
        now,
      });

      expect(requests).toHaveLength(1);
      expect(clickHouseStub.calls).toHaveLength(1);
      expect(clickHouseStub.calls[0]?.query).toContain("FROM evaluation_analytics");
      expect(clickHouseStub.calls[0]?.query).not.toContain("FROM trace_analytics");
    });
  });

  describe("given an unknown-source trigger (no field-availability mapping)", () => {
    it("defaults to trace and queries trace_analytics", async () => {
      const noDataParams = {
        operator: "lt",
        threshold: 1,
        timePeriod: 60,
        seriesName: "0/sentiment.thumbs/avg",
      };
      const triggers = makeTriggersService({
        [PROJECT]: [makeTrigger("unknown", "graph-unknown", noDataParams)],
      });

      const deps: GraphTriggerHeartbeatDeps = {
        triggers,
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => clickHouseStub.client,
        featureFlagService: makeFlagsAllOn(),
        // lookupTriggerSource returns undefined → heartbeat defaults to "trace".
        lookupTriggerSource: async () => undefined,
      };

      await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT] }),
        now,
      });

      expect(clickHouseStub.calls).toHaveLength(1);
      expect(clickHouseStub.calls[0]?.query).toContain("FROM trace_analytics");
    });
  });
});
