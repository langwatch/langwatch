import { TriggerAction, TriggerKind } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ReportScheduleTarget,
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
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: {},
    filters: {},
    alertType: null,
    message: null,
    customGraphId: null,
    notificationCadence: "immediate",
    filterQuery: null,
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

  async findActiveReportTargets(): Promise<ReportScheduleTarget[]> {
    return [];
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

    // A scheduled report persists `filters: {}` and no `customGraphId` — the
    // exact shape of a match-everything trace automation. Before ADR-044's
    // `triggerKind` reached this read, every weekly report was a candidate
    // trace trigger, so the notify reactor enqueued a settle (and the settle
    // dispatcher waved it through, its filter guard being a no-op on empty
    // filters) for EVERY ingested trace: one report => one notification per
    // trace. The report's real firing path is its scheduler calendar entry.
    describe("given the project has a scheduled report alongside a trace trigger", () => {
      beforeEach(() => {
        repo.rowsByProject.set("p1", [
          makeSummary({ id: "trace_trigger" }),
          makeSummary({
            id: "weekly_report",
            triggerKind: TriggerKind.REPORT,
            action: TriggerAction.SEND_SLACK_MESSAGE,
            filters: {},
            customGraphId: null,
          }),
        ]);
      });

      describe("when fetching the active trace triggers", () => {
        it("excludes the report so it never fires per ingested trace", async () => {
          const result = await service.getActiveTraceTriggersForProject("p1");
          expect(result.map((t) => t.id)).toEqual(["trace_trigger"]);
        });
      });
    });
  });

  describe("getActiveGraphTriggersForProject", () => {
    // Converting a graph alert into a report leaves the old `customGraphId` on
    // the row, so kind — not the column — has to be what disarms it here too.
    describe("given a report row that still carries a customGraphId", () => {
      beforeEach(() => {
        repo.rowsByProject.set("p1", [
          makeSummary({ id: "graph_alert", customGraphId: "graph_1" }),
          makeSummary({
            id: "graph_report",
            triggerKind: TriggerKind.REPORT,
            customGraphId: "graph_1",
          }),
        ]);
      });

      describe("when fetching the active graph triggers", () => {
        it("excludes the report so it never fires as a threshold alert", async () => {
          const result = await service.getActiveGraphTriggersForProject("p1");
          expect(result.map((t) => t.id)).toEqual(["graph_alert"]);
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
