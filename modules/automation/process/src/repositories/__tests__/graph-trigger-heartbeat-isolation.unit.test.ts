// Per-project error isolation for the heartbeat; a failure must not silence
// no-data alerts for all projects.

import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { TriggerSummary } from "@langwatch/automation-contract";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type GraphTriggerHeartbeatDeps,
  GraphTriggerHeartbeatService,
} from "../../services/graph-trigger-heartbeat.service.ts";
import type { GraphTriggerSentRepository } from "../graph-trigger-sent.repository.ts";
import { HeartbeatTriggerRepository, SilentAutomationLogger } from "./support/heartbeat.fakes.ts";

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
  const triggers = new HeartbeatTriggerRepository({});
  triggers.findActiveForProject = getActiveGraphTriggersForProject;

  return {
    triggers,
    triggerSent: {
      findProjectsWithGraphTriggers: async () => [BROKEN, HEALTHY],
      findProjectsWithOpenGraphTriggerSent: async () => new Set(),
      findGraphTriggerSource: async () => "trace",
      findOpenTriggerIdsForProject: async () => new Set(),
      findOpenForGraphAlert: async () => null,
      findLatestForGraphAlert: async () => null,
      claimOpenForGraphAlert: async () => "already-claimed" as const,
      deleteOpenClaim: async () => undefined,
      markResolvedById: async () => undefined,
    } satisfies GraphTriggerSentRepository,
    analytics: createApiFixture<AnalyticsApi>({ findLastOccurredAt: async () => [] }),
    logger: new SilentAutomationLogger(),
  };
}

describe("decideGraphTriggerHeartbeat per-project isolation", () => {
  const now = Temporal.Instant.from("2026-06-20T12:00:00Z");

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
