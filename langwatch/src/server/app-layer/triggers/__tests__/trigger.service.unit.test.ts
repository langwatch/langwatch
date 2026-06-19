import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  TriggerRepository,
  TriggerSummary,
} from "../repositories/trigger.repository";
import { TriggerService } from "../trigger.service";

function makeSummary(
  overrides: Partial<TriggerSummary> & { id: string },
): TriggerSummary {
  return {
    projectId: "p1",
    name: overrides.id,
    action: TriggerAction.SEND_EMAIL,
    actionParams: {},
    filters: {},
    alertType: null,
    message: null,
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 30000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

class FakeTriggerRepository implements TriggerRepository {
  rowsByProject = new Map<string, TriggerSummary[]>();
  findActiveCalls = 0;
  claimSendCalls: Array<{
    triggerId: string;
    traceId: string;
    projectId: string;
  }> = [];
  isSendClaimedCalls: Array<{
    triggerId: string;
    traceId: string;
    projectId: string;
  }> = [];
  updateLastRunAtCalls: Array<{ triggerId: string; projectId: string }> = [];

  claimSendResult = true;
  isSendClaimedResult = false;

  async findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
    this.findActiveCalls++;
    return this.rowsByProject.get(projectId) ?? [];
  }

  async claimSend(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    this.claimSendCalls.push(params);
    return this.claimSendResult;
  }

  async isSendClaimed(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    this.isSendClaimedCalls.push(params);
    return this.isSendClaimedResult;
  }

  async updateLastRunAt(triggerId: string, projectId: string): Promise<void> {
    this.updateLastRunAtCalls.push({ triggerId, projectId });
  }
}

describe("TriggerService", () => {
  let repo: FakeTriggerRepository;
  let service: TriggerService;

  beforeEach(() => {
    repo = new FakeTriggerRepository();
    service = new TriggerService(repo);
  });

  describe("getActiveTraceTriggersForProject", () => {
    describe("given the project has both trace and custom-graph triggers", () => {
      beforeEach(() => {
        repo.rowsByProject.set("p1", [
          makeSummary({ id: "trace_trigger" }),
          makeSummary({ id: "graph_trigger", customGraphId: "graph_1" }),
        ]);
      });

      describe("when fetching the active trace triggers", () => {
        it("filters out triggers bound to a custom graph", async () => {
          const result = await service.getActiveTraceTriggersForProject("p1");
          expect(result.map((t) => t.id)).toEqual(["trace_trigger"]);
        });
      });

      describe("when fetching twice in a row", () => {
        it("serves the second call from cache without re-hitting the repo", async () => {
          await service.getActiveTraceTriggersForProject("p1");
          await service.getActiveTraceTriggersForProject("p1");
          expect(repo.findActiveCalls).toBe(1);
        });
      });

      describe("when the project is invalidated after a fetch", () => {
        it("forces a refetch on the next call", async () => {
          await service.getActiveTraceTriggersForProject("p1");
          await service.invalidate("p1");
          await service.getActiveTraceTriggersForProject("p1");
          expect(repo.findActiveCalls).toBe(2);
        });
      });
    });
  });

  describe("claimSend", () => {
    describe("when claiming a (trigger, trace) pair", () => {
      it("forwards the params to the repo and returns its result", async () => {
        repo.claimSendResult = true;
        const params = {
          triggerId: "trig_1",
          traceId: "trace_1",
          projectId: "p1",
        };
        const claimed = await service.claimSend(params);
        expect(claimed).toBe(true);
        expect(repo.claimSendCalls).toEqual([params]);
      });
    });
  });

  describe("isSendClaimed", () => {
    describe("when checking an existing claim", () => {
      it("forwards the params to the repo and returns its result", async () => {
        repo.isSendClaimedResult = true;
        const params = {
          triggerId: "trig_1",
          traceId: "trace_1",
          projectId: "p1",
        };
        const claimed = await service.isSendClaimed(params);
        expect(claimed).toBe(true);
        expect(repo.isSendClaimedCalls).toEqual([params]);
      });
    });
  });

  describe("updateLastRunAt", () => {
    describe("when recording a run", () => {
      it("forwards the trigger and project ids to the repo", async () => {
        await service.updateLastRunAt("trig_1", "p1");
        expect(repo.updateLastRunAtCalls).toEqual([
          { triggerId: "trig_1", projectId: "p1" },
        ]);
      });
    });
  });
});
