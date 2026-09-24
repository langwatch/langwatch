/**
 * Source-awareness tests for the graph-trigger heartbeat: it groups
 * triggers per (project, source), issuing one batched recency query per
 * pair per tick, each naming its source to the analytics module's recency read.
 */

import type { AnalyticsApi, AnalyticsMetricSource } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { TriggerSummary } from "@langwatch/automation-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type GraphTriggerHeartbeatDeps,
  GraphTriggerHeartbeatService,
} from "../../services/graph-trigger-heartbeat.service.ts";
import type { GraphTriggerSentRepository } from "../graph-trigger-sent.repository.ts";
import { HeartbeatTriggerRepository, SilentAutomationLogger } from "./support/heartbeat.fakes.ts";

const TriggerAction = { SEND_EMAIL: "SEND_EMAIL" } as const;
const TriggerKind = { ALERT: "ALERT" } as const;
type HeartbeatCandidateSources = {
  loadProjectsWithGraphTriggers(): Promise<string[]>;
  loadProjectsWithOpenGraphTriggerSent(): Promise<Set<string>>;
};

async function decideGraphTriggerHeartbeat(input: {
  deps: GraphTriggerHeartbeatDeps;
  sources: HeartbeatCandidateSources;
  now: Instant;
}) {
  input.deps.triggerSent.findProjectsWithGraphTriggers = () =>
    input.sources.loadProjectsWithGraphTriggers();
  input.deps.triggerSent.findProjectsWithOpenGraphTriggerSent = () =>
    input.sources.loadProjectsWithOpenGraphTriggerSent();

  return GraphTriggerHeartbeatService.create(input.deps).decide({ now: input.now });
}

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
    triggerKind: TriggerKind.ALERT,
    actionParams,
    filters: {},
    alertType: null,
    message: null,
    customGraphId,
    notificationCadence: "immediate",
    filterQuery: null,
    traceDebounceMs: 30_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
  };
}

function makeTriggersService(perProject: Record<string, TriggerSummary[]>) {
  return new HeartbeatTriggerRepository(perProject);
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

function makeTriggerSentStub(
  sourceByTrigger: Record<string, AnalyticsMetricSource | undefined> = {},
): GraphTriggerSentRepository {
  return {
    findProjectsWithGraphTriggers: async () => [],
    findProjectsWithOpenGraphTriggerSent: async () => new Set(),
    findGraphTriggerSource: async ({ triggerId }) => sourceByTrigger[triggerId],
    findOpenTriggerIdsForProject: async () => new Set(),
    findOpenForGraphAlert: async () => null,
    findLatestForGraphAlert: async () => null,
    claimOpenForGraphAlert: async () => "already-claimed" as const,
    deleteOpenClaim: async () => undefined,
    markResolvedById: async () => undefined,
  };
}

interface RecencyCall {
  source: AnalyticsMetricSource;
  tenantId: string;
}

function makeAnalyticsStub(): {
  analytics: AnalyticsApi;
  calls: RecencyCall[];
} {
  const calls: RecencyCall[] = [];
  const analytics = createApiFixture<AnalyticsApi>({
    findLastOccurredAt: vi.fn(async (input: Parameters<AnalyticsApi["findLastOccurredAt"]>[0]) => {
      calls.push({ source: input.source, tenantId: input.projectId });
      // No recency so EVERY candidate enqueues (the test cares about
      // source routing, not enqueue filtering).
      return [];
    }),
  });
  return { analytics, calls };
}

describe("decideGraphTriggerHeartbeat source-awareness (ADR-034 Phase 6)", () => {
  const now = Temporal.Instant.from("2026-06-20T12:00:00Z");
  let analyticsStub: ReturnType<typeof makeAnalyticsStub>;

  beforeEach(() => {
    analyticsStub = makeAnalyticsStub();
  });

  describe("given a project with one trace-source and one eval-source graph trigger", () => {
    /** @scenario "Graph heartbeat isolates projects and metric sources" */
    it("reads trace recency once and evaluation recency once", async () => {
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
        triggerSent: makeTriggerSentStub(sourceByTrigger),
        analytics: analyticsStub.analytics,
        logger: new SilentAutomationLogger(),
      };

      const requests = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT] }),
        now,
      });

      // Both triggers enqueued (recency null → no skip).
      expect(requests).toHaveLength(2);

      // Exactly two reads — one per source.
      expect(analyticsStub.calls).toHaveLength(2);
      const traceCall = analyticsStub.calls.find((c) => c.source === "trace");
      const evalCall = analyticsStub.calls.find((c) => c.source === "evaluation");
      expect(traceCall).toBeDefined();
      expect(evalCall).toBeDefined();
      expect(traceCall?.tenantId).toBe(PROJECT);
      expect(evalCall?.tenantId).toBe(PROJECT);
    });
  });

  describe("given a project with only an eval-source trigger", () => {
    it("reads evaluation recency only, never trace recency", async () => {
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
        triggerSent: makeTriggerSentStub({ [TRIGGER_EVAL]: "evaluation" }),
        analytics: analyticsStub.analytics,
        logger: new SilentAutomationLogger(),
      };

      const requests = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT] }),
        now,
      });

      expect(requests).toHaveLength(1);
      expect(analyticsStub.calls).toEqual([{ source: "evaluation", tenantId: PROJECT }]);
    });
  });

  describe("given an unknown-source trigger (no field-availability mapping)", () => {
    it("defaults to trace and reads trace recency", async () => {
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
        triggerSent: makeTriggerSentStub(),
        analytics: analyticsStub.analytics,
        logger: new SilentAutomationLogger(),
      };

      await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT] }),
        now,
      });

      expect(analyticsStub.calls).toEqual([{ source: "trace", tenantId: PROJECT }]);
    });
  });
});
