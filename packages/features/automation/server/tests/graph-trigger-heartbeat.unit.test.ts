import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type GraphTriggerHeartbeatDeps,
  type ClickHouseClient,
  GraphTriggerHeartbeatService,
} from "../src/services/graph-trigger-heartbeat.service";
import type { TriggerSummary } from "@langwatch/automation-contract";
import type { GraphTriggerSentRepository } from "../src/repositories/graph-trigger-sent.repository";
import { HeartbeatTriggerRepository, SilentAutomationLogger } from "./support/heartbeat.fakes";

const TriggerAction = { SEND_EMAIL: "SEND_EMAIL" } as const;
const TriggerKind = { ALERT: "ALERT" } as const;
type HeartbeatCandidateSources = {
  loadProjectsWithGraphTriggers(): Promise<string[]>;
  loadProjectsWithOpenGraphTriggerSent(): Promise<Set<string>>;
};

async function decideGraphTriggerHeartbeat(input: {
  deps: GraphTriggerHeartbeatDeps;
  sources: HeartbeatCandidateSources;
  now: Date;
}) {
  input.deps.triggerSent.findProjectsWithGraphTriggers =
    input.sources.loadProjectsWithGraphTriggers;
  input.deps.triggerSent.findProjectsWithOpenGraphTriggerSent =
    input.sources.loadProjectsWithOpenGraphTriggerSent;

  return GraphTriggerHeartbeatService.create(input.deps).decide({ now: input.now });
}

const PROJECT_A = "proj-a";
const PROJECT_B = "proj-b";
const TRIGGER_NO_DATA = "trig-no-data";
const TRIGGER_OPEN = "trig-open";
const TRIGGER_NORMAL = "trig-normal";

function makeTrigger(
  id: string,
  projectId: string,
  actionParams: Record<string, unknown>,
  customGraphId = `graph-${id}`,
): TriggerSummary {
  return {
    id,
    projectId,
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
  perProjectOpenTriggers: Record<string, string[]>,
): GraphTriggerSentRepository {
  return {
    findProjectsWithGraphTriggers: async () => [],
    findProjectsWithOpenGraphTriggerSent: async () => new Set(),
    tryFindGraphTriggerSource: async () => "trace",
    findOpenTriggerIdsForProject: async (projectId) =>
      new Set(perProjectOpenTriggers[projectId] ?? []),
    tryFindOpenForGraphAlert: async () => null,
    tryFindLatestForGraphAlert: async () => null,
    tryClaimOpenForGraphAlert: async () => null,
    deleteOpenClaim: async () => undefined,
    markResolvedById: async () => undefined,
  };
}

function makeClickHouseStub(maxOccurredAtMsByProject: Record<string, number | null>): {
  client: ClickHouseClient;
  callsByProject: Record<string, number>;
} {
  const callsByProject: Record<string, number> = {};
  const client = {
    query: vi.fn(async (params: { query_params: { tenantId: string } }) => {
      const projectId = params.query_params.tenantId;
      callsByProject[projectId] = (callsByProject[projectId] ?? 0) + 1;
      const ms = maxOccurredAtMsByProject[projectId];
      return {
        json: async () => [{ lastMs: ms ?? null }],
      };
    }),
  } as unknown as ClickHouseClient;
  return { client, callsByProject };
}

describe("decideGraphTriggerHeartbeat", () => {
  const now = new Date("2026-06-20T12:00:00Z");

  let triggerSentStub: GraphTriggerSentRepository;
  let chStub: ReturnType<typeof makeClickHouseStub>;
  let deps: GraphTriggerHeartbeatDeps;

  beforeEach(() => {
    triggerSentStub = makeTriggerSentStub({});
    chStub = makeClickHouseStub({});
  });

  describe("given no candidate projects", () => {
    it("returns no enqueues", async () => {
      const triggers = makeTriggersService({});
      deps = {
        triggers,
        triggerSent: triggerSentStub,
        heartbeat: { tryResolveClickHouseClient: async () => chStub.client },
        logger: new SilentAutomationLogger(),
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [] }),
        now,
      });

      expect(result).toEqual([]);
    });
  });

  describe("given a project with only normal (non-absence) triggers", () => {
    it("emits no enqueues — real-time path handles them", async () => {
      const triggers = makeTriggersService({
        [PROJECT_A]: [
          makeTrigger(TRIGGER_NORMAL, PROJECT_A, {
            threshold: 50,
            operator: "gt",
            timePeriod: 60,
          }),
        ],
      });
      deps = {
        triggers,
        triggerSent: triggerSentStub,
        heartbeat: { tryResolveClickHouseClient: async () => chStub.client },
        logger: new SilentAutomationLogger(),
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT_A] }),
        now,
      });

      expect(result).toEqual([]);
    });
  });

  describe("given a no-data trigger with no recent activity", () => {
    it("enqueues a heartbeat-absence eval", async () => {
      chStub = makeClickHouseStub({ [PROJECT_A]: null });
      const triggers = makeTriggersService({
        [PROJECT_A]: [
          makeTrigger(TRIGGER_NO_DATA, PROJECT_A, {
            threshold: 1,
            operator: "lt",
            timePeriod: 5,
          }),
        ],
      });
      deps = {
        triggers,
        triggerSent: triggerSentStub,
        heartbeat: { tryResolveClickHouseClient: async () => chStub.client },
        logger: new SilentAutomationLogger(),
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT_A] }),
        now,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.reason).toBe("heartbeat-absence");
      expect(result[0]?.triggerId).toBe(TRIGGER_NO_DATA);
      expect(result[0]?.projectId).toBe(PROJECT_A);
    });
  });

  describe("given a no-data trigger but the project has very recent activity", () => {
    it("skips the enqueue — real-time path handles it", async () => {
      const recentMs = now.getTime() - 30_000;
      chStub = makeClickHouseStub({ [PROJECT_A]: recentMs });
      const triggers = makeTriggersService({
        [PROJECT_A]: [
          makeTrigger(TRIGGER_NO_DATA, PROJECT_A, {
            threshold: 1,
            operator: "lt",
            timePeriod: 5,
          }),
        ],
      });
      deps = {
        triggers,
        triggerSent: triggerSentStub,
        heartbeat: { tryResolveClickHouseClient: async () => chStub.client },
        logger: new SilentAutomationLogger(),
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT_A] }),
        now,
      });

      expect(result).toEqual([]);
      expect(chStub.callsByProject[PROJECT_A]).toBe(1);
    });
  });

  describe("given an open TriggerSent and the project has gone silent", () => {
    it("enqueues a heartbeat-resolve eval", async () => {
      chStub = makeClickHouseStub({ [PROJECT_B]: null });
      triggerSentStub = makeTriggerSentStub({ [PROJECT_B]: [TRIGGER_OPEN] });
      const triggers = makeTriggersService({
        [PROJECT_B]: [
          makeTrigger(TRIGGER_OPEN, PROJECT_B, {
            threshold: 100,
            operator: "gt",
            timePeriod: 5,
          }),
        ],
      });
      deps = {
        triggers,
        triggerSent: triggerSentStub,
        heartbeat: { tryResolveClickHouseClient: async () => chStub.client },
        logger: new SilentAutomationLogger(),
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({
          openSentProjects: new Set([PROJECT_B]),
        }),
        now,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.reason).toBe("heartbeat-resolve");
      expect(result[0]?.triggerId).toBe(TRIGGER_OPEN);
    });
  });

  describe("given multiple projects, batched ClickHouse pre-filter", () => {
    it("issues one CH query per project per tick", async () => {
      chStub = makeClickHouseStub({
        [PROJECT_A]: null,
        [PROJECT_B]: null,
      });
      const triggers = makeTriggersService({
        [PROJECT_A]: [
          makeTrigger(TRIGGER_NO_DATA, PROJECT_A, {
            threshold: 1,
            operator: "lt",
            timePeriod: 5,
          }),
        ],
        [PROJECT_B]: [
          makeTrigger(TRIGGER_NO_DATA, PROJECT_B, {
            threshold: 1,
            operator: "lt",
            timePeriod: 5,
          }),
        ],
      });
      deps = {
        triggers,
        triggerSent: triggerSentStub,
        heartbeat: { tryResolveClickHouseClient: async () => chStub.client },
        logger: new SilentAutomationLogger(),
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({
          graphProjects: [PROJECT_A, PROJECT_B],
        }),
        now,
      });

      expect(result).toHaveLength(2);
      expect(chStub.callsByProject[PROJECT_A]).toBe(1);
      expect(chStub.callsByProject[PROJECT_B]).toBe(1);
    });
  });
});
