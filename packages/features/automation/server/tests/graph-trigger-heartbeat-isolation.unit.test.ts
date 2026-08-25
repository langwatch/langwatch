/**
 * Per-project error isolation for the graph-trigger heartbeat.
 *
 * The heartbeat is the ONLY path that fires no-data alerts and resolves
 * firing alerts when traffic stops. A tick that aborts on the first project's
 * transient error therefore silences absence alerts for EVERY project for as
 * long as that error persists — a silent, cross-tenant outage.
 *
 * The per-project candidate load is isolated: a failure logs and the tick
 * continues with the next project.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type GraphTriggerHeartbeatDeps,
  type HeartbeatCandidateSources,
  GraphTriggerHeartbeatService,
} from "../src/services/graph-trigger-heartbeat.service";
import type { TriggerSummary } from "@langwatch/automation-contract";
import type { AutomationService } from "@langwatch/automation-contract";
import type { GraphTriggerSentRepository } from "../src/repositories/graph-trigger-sent.repository";

const TriggerAction = { SEND_EMAIL: "SEND_EMAIL" } as const;
const decideGraphTriggerHeartbeat = GraphTriggerHeartbeatService.decide;

const BROKEN = "proj-broken";
const HEALTHY = "proj-healthy";

/** A no-data shape: "value < 1" breaches at zero. */
const NO_DATA_PARAMS = {
  operator: "lt",
  threshold: 1,
  timePeriod: 60,
  seriesName: "0/metadata.trace_id/cardinality",
};

function makeTrigger(id: string, customGraphId: string): TriggerSummary {
  return {
    id,
    projectId: HEALTHY,
    customGraphId,
    active: true,
    action: TriggerAction.SEND_EMAIL,
    actionParams: NO_DATA_PARAMS,
  } as unknown as TriggerSummary;
}

function makeSources(): HeartbeatCandidateSources {
  return {
    loadProjectsWithGraphTriggers: async () => [BROKEN, HEALTHY],
    loadProjectsWithOpenGraphTriggerSent: async () => new Set<string>(),
  };
}

function makeDeps({
  getActiveGraphTriggersForProject,
}: {
  getActiveGraphTriggersForProject: (p: string) => Promise<TriggerSummary[]>;
}): GraphTriggerHeartbeatDeps {
  const clickHouse = {
    query: vi.fn(async () => ({ json: async () => [{ lastMs: null }] })),
  };
  return {
    automation: { getActiveGraphTriggersForProject } as unknown as AutomationService,
    triggerSent: {
      findProjectsWithGraphTriggers: async () => [],
      findProjectsWithOpenGraphTriggerSent: async () => new Set(),
      tryFindGraphTriggerSource: async () => "trace",
      findOpenTriggerIdsForProject: async () => new Set(),
      tryFindOpenForGraphAlert: async () => null,
      tryFindLatestForGraphAlert: async () => null,
      tryClaimOpenForGraphAlert: async () => null,
      deleteOpenClaim: async () => undefined,
      markResolvedById: async () => undefined,
    } satisfies GraphTriggerSentRepository,
    resolveClickHouseClient: (async () =>
      clickHouse) as unknown as GraphTriggerHeartbeatDeps["resolveClickHouseClient"],
  };
}

describe("decideGraphTriggerHeartbeat per-project isolation", () => {
  const now = new Date("2026-06-20T12:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given one project's candidate load throws", () => {
    it("still enqueues the healthy project's absence evaluation", async () => {
      const requests = await decideGraphTriggerHeartbeat({
        deps: makeDeps({
          getActiveGraphTriggersForProject: async (projectId: string) => {
            if (projectId === BROKEN) throw new Error("db unavailable");
            return [makeTrigger("trig-healthy", "graph-healthy")];
          },
        }),
        sources: makeSources(),
        now,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ projectId: HEALTHY });
    });

    it("does not enqueue anything for the failing project", async () => {
      const requests = await decideGraphTriggerHeartbeat({
        deps: makeDeps({
          getActiveGraphTriggersForProject: async (projectId: string) => {
            if (projectId === BROKEN) throw new Error("db unavailable");
            return [makeTrigger("trig-healthy", "graph-healthy")];
          },
        }),
        sources: makeSources(),
        now,
      });

      const projectIds = requests.map((r) => r.projectId);
      expect(projectIds).not.toContain(BROKEN);
    });
  });
});
