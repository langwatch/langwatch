import type { ClickHouseClient } from "@clickhouse/client";
import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag/types";
import type {
  GraphEvalStagePayload,
} from "~/server/event-sourcing/outbox/payload";
import type {
  TriggerSummary,
} from "../repositories/trigger.repository";
import type { TriggerService } from "../trigger.service";
import {
  decideGraphTriggerHeartbeat,
  defaultCandidateSources,
  type GraphTriggerHeartbeatDeps,
  type HeartbeatCandidateSources,
} from "../graph-trigger-heartbeat";

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

function makeTriggersService(
  perProject: Record<string, TriggerSummary[]>,
): TriggerService {
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

function makePrismaStub(perProjectOpenTriggers: Record<string, string[]>): {
  triggerSent: {
    findMany: ReturnType<typeof vi.fn>;
  };
} {
  return {
    triggerSent: {
      findMany: vi.fn(async (args: { where: { projectId: string } }) => {
        const projectId = args.where.projectId;
        const ids = perProjectOpenTriggers[projectId] ?? [];
        return ids.map((triggerId) => ({ triggerId }));
      }),
    },
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

  let prismaStub: ReturnType<typeof makePrismaStub>;
  let chStub: ReturnType<typeof makeClickHouseStub>;
  let deps: GraphTriggerHeartbeatDeps;

  beforeEach(() => {
    prismaStub = makePrismaStub({});
    chStub = makeClickHouseStub({});
  });

  describe("given no flagged projects", () => {
    it("returns no enqueues", async () => {
      const triggers = makeTriggersService({
        [PROJECT_A]: [
          makeTrigger(TRIGGER_NO_DATA, PROJECT_A, {
            threshold: 1,
            operator: "lt",
            timePeriod: 5,
          }),
        ],
      });
      const flags: FeatureFlagServiceInterface = {
        isEnabled: vi.fn(async () => false),
      };
      deps = {
        triggers,
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => chStub.client,
        featureFlagService: flags,
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT_A] }),
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
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => chStub.client,
        featureFlagService: makeFlagsAllOn(),
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
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => chStub.client,
        featureFlagService: makeFlagsAllOn(),
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({ graphProjects: [PROJECT_A] }),
        now,
      });

      expect(result).toHaveLength(1);
      const payload = result[0]?.payload as unknown as GraphEvalStagePayload;
      expect(payload.reason).toBe("heartbeat-absence");
      expect(payload.triggerId).toBe(TRIGGER_NO_DATA);
      expect(result[0]?.dedupKey).toBe(
        `${PROJECT_A}/${TRIGGER_NO_DATA}:graph:hb`,
      );
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
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => chStub.client,
        featureFlagService: makeFlagsAllOn(),
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
      prismaStub = makePrismaStub({ [PROJECT_B]: [TRIGGER_OPEN] });
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
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => chStub.client,
        featureFlagService: makeFlagsAllOn(),
      };

      const result = await decideGraphTriggerHeartbeat({
        deps,
        sources: makeSources({
          openSentProjects: new Set([PROJECT_B]),
        }),
        now,
      });

      expect(result).toHaveLength(1);
      const payload = result[0]?.payload as unknown as GraphEvalStagePayload;
      expect(payload.reason).toBe("heartbeat-resolve");
      expect(payload.triggerId).toBe(TRIGGER_OPEN);
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
        prisma: prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
        resolveClickHouseClient: async () => chStub.client,
        featureFlagService: makeFlagsAllOn(),
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

describe("defaultCandidateSources", () => {
  // Regression: Trigger / TriggerSent are project-scoped models, so the
  // multitenancy middleware rejects a bare cross-project findMany. These
  // scans must enumerate project ids from the global Project model first and
  // scope with projectId: { in }, or the heartbeat throws every tick.
  type FindManyArgs = { where?: { projectId?: unknown } };
  function makePrismaStub() {
    return {
      project: {
        findMany: vi.fn(async (_args?: FindManyArgs) => [
          { id: PROJECT_A },
          { id: PROJECT_B },
        ]),
      },
      trigger: {
        findMany: vi.fn(async (_args?: FindManyArgs) => [
          { projectId: PROJECT_A },
        ]),
      },
      triggerSent: {
        findMany: vi.fn(async (_args?: FindManyArgs) => [
          { projectId: PROJECT_B },
        ]),
      },
    };
  }

  describe("when loading projects with graph triggers", () => {
    it("scopes the Trigger scan with projectId in the enumerated project ids", async () => {
      const prismaStub = makePrismaStub();
      const sources = defaultCandidateSources(
        prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
      );

      const projects = await sources.loadProjectsWithGraphTriggers();

      expect(prismaStub.project.findMany).toHaveBeenCalledTimes(1);
      const triggerWhere = prismaStub.trigger.findMany.mock.calls[0]?.[0]?.where;
      expect(triggerWhere?.projectId).toEqual({ in: [PROJECT_A, PROJECT_B] });
      expect(projects).toEqual([PROJECT_A]);
    });
  });

  describe("when loading projects with open graph TriggerSent", () => {
    it("scopes the TriggerSent scan with projectId in the enumerated project ids", async () => {
      const prismaStub = makePrismaStub();
      const sources = defaultCandidateSources(
        prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
      );

      const projects = await sources.loadProjectsWithOpenGraphTriggerSent();

      const sentWhere = prismaStub.triggerSent.findMany.mock.calls[0]?.[0]?.where;
      expect(sentWhere?.projectId).toEqual({ in: [PROJECT_A, PROJECT_B] });
      expect(projects).toEqual(new Set([PROJECT_B]));
    });
  });

  describe("when there are no candidate projects", () => {
    it("returns empty without issuing an unscoped Trigger scan", async () => {
      const prismaStub = makePrismaStub();
      prismaStub.project.findMany = vi.fn(async () => []);
      const sources = defaultCandidateSources(
        prismaStub as unknown as GraphTriggerHeartbeatDeps["prisma"],
      );

      const projects = await sources.loadProjectsWithGraphTriggers();

      expect(projects).toEqual([]);
      expect(prismaStub.trigger.findMany).not.toHaveBeenCalled();
    });
  });
});
