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
  GraphTriggerHeartbeatService,
} from "../../services/graph-trigger-heartbeat.service";
import type { TriggerSummary } from "@langwatch/automation-contract";
import type { GraphTriggerSentRepository } from "../graph-trigger-sent.repository";
import { HeartbeatTriggerRepository, SilentAutomationLogger } from "./support/heartbeat.fakes";

const TriggerAction = { SEND_EMAIL: "SEND_EMAIL" } as const;

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
    name: id,
    projectId: HEALTHY,
    customGraphId,
    action: TriggerAction.SEND_EMAIL,
    triggerKind: "ALERT",
    actionParams: NO_DATA_PARAMS,
    filters: {},
    alertType: null,
    message: null,
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

function makeDeps({
  getActiveGraphTriggersForProject,
}: {
  getActiveGraphTriggersForProject: (p: string) => Promise<TriggerSummary[]>;
}): GraphTriggerHeartbeatDeps {
  const clickHouse = {
    query: vi.fn(async () => ({ json: async () => [{ lastMs: null }] })),
  };
  const triggers = new HeartbeatTriggerRepository({});
  triggers.findActiveForProject = getActiveGraphTriggersForProject;

  return {
    triggers,
    triggerSent: {
      findProjectsWithGraphTriggers: async () => [BROKEN, HEALTHY],
      findProjectsWithOpenGraphTriggerSent: async () => new Set(),
      tryFindGraphTriggerSource: async () => "trace",
      findOpenTriggerIdsForProject: async () => new Set(),
      tryFindOpenForGraphAlert: async () => null,
      tryFindLatestForGraphAlert: async () => null,
      tryClaimOpenForGraphAlert: async () => null,
      deleteOpenClaim: async () => undefined,
      markResolvedById: async () => undefined,
    } satisfies GraphTriggerSentRepository,
    heartbeat: { tryResolveClickHouseClient: async () => clickHouse },
    logger: new SilentAutomationLogger(),
  };
}

describe("decideGraphTriggerHeartbeat per-project isolation", () => {
  const now = new Date("2026-06-20T12:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given one project's candidate load throws", () => {
    /** @scenario "Graph heartbeat isolates projects and metric sources" */
    it("still enqueues the healthy project's absence evaluation", async () => {
      const service = GraphTriggerHeartbeatService.create(
        makeDeps({
          getActiveGraphTriggersForProject: async (projectId: string) => {
            if (projectId === BROKEN) throw new Error("db unavailable");
            return [makeTrigger("trig-healthy", "graph-healthy")];
          },
        }),
      );
      const requests = await service.decide({ now });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ projectId: HEALTHY });
    });

    /** @scenario "Graph heartbeat isolates projects and metric sources" */
    it("does not enqueue anything for the failing project", async () => {
      const service = GraphTriggerHeartbeatService.create(
        makeDeps({
          getActiveGraphTriggersForProject: async (projectId: string) => {
            if (projectId === BROKEN) throw new Error("db unavailable");
            return [makeTrigger("trig-healthy", "graph-healthy")];
          },
        }),
      );
      const requests = await service.decide({ now });

      const projectIds = requests.map((r) => r.projectId);
      expect(projectIds).not.toContain(BROKEN);
    });
  });
});
