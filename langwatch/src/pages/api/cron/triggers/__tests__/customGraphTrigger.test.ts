import { type Project, type Trigger, TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processCustomGraphTrigger } from "../customGraphTrigger";

vi.mock("~/server/analytics/timeseries", () => ({
  timeseries: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    customGraph: {
      findUnique: vi.fn(),
    },
    triggerSent: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../actions/sendEmail", () => ({
  handleSendEmail: vi.fn(),
}));

vi.mock("../actions/sendSlackMessage", () => ({
  handleSendSlackMessage: vi.fn(),
}));

vi.mock("../utils", () => ({
  updateAlert: vi.fn(),
  checkThreshold: vi.fn(),
  addTriggersSent: vi.fn(),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

import { timeseries } from "~/server/analytics/timeseries";
import { prisma } from "~/server/db";
import { captureException } from "~/utils/posthogErrorCapture";
import { handleSendEmail } from "../actions/sendEmail";
import { handleSendSlackMessage } from "../actions/sendSlackMessage";
import { checkThreshold, updateAlert } from "../utils";

describe("processCustomGraphTrigger", () => {
  const mockProjects: Project[] = [
    { id: "project-1", slug: "test-project" } as Project,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: no unresolved trigger (new alert will be sent)
    vi.mocked(prisma.triggerSent.findFirst).mockResolvedValue(null);
  });

  describe("when trigger has no customGraphId", () => {
    it("returns error status with message", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: null,
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/metadata.trace_id/cardinality",
        },
      } as unknown as Trigger;

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "error",
        message: "No customGraphId found",
      });
    });
  });

  describe("when custom graph is not found", () => {
    it("returns error status with message", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: "graph-1",
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/metadata.trace_id/cardinality",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue(null);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "error",
        message: "Graph not found",
      });
    });
  });

  describe("when graph has no series", () => {
    it("returns error status with message", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: "graph-1",
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/metadata.trace_id/cardinality",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: { series: [] },
        filters: {},
      } as any);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "error",
        message: "No series found in graph",
      });
    });
  });

  describe("when seriesName is missing", () => {
    it("returns error status with message", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: "graph-1",
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [{ name: "metric1", metric: "count", aggregation: "count" }],
        },
        filters: {},
      } as any);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "error",
        message: "seriesName is required in ActionParams",
      });
    });
  });

  describe("when seriesName has invalid index", () => {
    it("returns error status when index is out of bounds", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: "graph-1",
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "5/count/count",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [{ name: "metric1", metric: "count", aggregation: "count" }],
        },
        filters: {},
      } as any);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "error",
        message: "Series index 5 not found in graph (has 1 series)",
      });
    });
  });

  describe("when monitoring second series in multi-series graph", () => {
    it("monitors the correct series based on index", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: "graph-1",
        action: TriggerAction.SEND_EMAIL,
        actionParams: {
          threshold: 50,
          operator: "gt",
          timePeriod: 60,
          seriesName: "1/errors/count",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [
            { name: "successes", metric: "success", aggregation: "count" },
            { name: "errors", metric: "errors", aggregation: "count" },
          ],
        },
        filters: {},
      } as any);

      vi.mocked(prisma.triggerSent.findFirst).mockResolvedValue(null);

      vi.mocked(timeseries).mockResolvedValue({
        currentPeriod: [{ "1/errors/count": 60 }, { "1/errors/count": 70 }],
        previousPeriod: [],
      } as any);
      vi.mocked(checkThreshold).mockReturnValue(true);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "triggered",
        value: 130,
        threshold: 50,
        operator: "gt",
      });
    });
  });

  describe("when threshold condition is met", () => {
    it("returns triggered status and updates trigger", async () => {
      const trigger = {
        id: "trigger-1",
        name: "Test Alert",
        projectId: "project-1",
        customGraphId: "graph-1",
        action: TriggerAction.SEND_EMAIL,
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          members: [],
          seriesName: "0/count/count",
        },
        message: "Custom message",
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [
            {
              name: "metric1",
              metric: "count",
              aggregation: "count",
            },
          ],
          timeScale: 60,
        },
        filters: {},
      } as any);

      vi.mocked(timeseries).mockResolvedValue({
        currentPeriod: [{ "0/count/count": 15 }, { "0/count/count": 20 }],
        previousPeriod: [],
      } as any);

      vi.mocked(checkThreshold).mockReturnValue(true);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "triggered",
        value: 35,
        threshold: 10,
        operator: "gt",
      });

      expect(handleSendEmail).toHaveBeenCalled();
      expect(updateAlert).toHaveBeenCalledWith(
        "trigger-1",
        expect.any(Number),
        "project-1",
      );
    });
  });

  describe("when threshold condition is not met", () => {
    it("returns not_triggered status and updates trigger", async () => {
      const trigger = {
        id: "trigger-1",
        name: "Test Alert",
        projectId: "project-1",
        customGraphId: "graph-1",
        action: TriggerAction.SEND_EMAIL,
        actionParams: {
          threshold: 100,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/count/count",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [
            {
              name: "metric1",
              metric: "count",
              aggregation: "count",
            },
          ],
        },
        filters: {},
      } as any);

      vi.mocked(timeseries).mockResolvedValue({
        currentPeriod: [{ "0/count/count": 5 }],
        previousPeriod: [],
      } as any);
      vi.mocked(checkThreshold).mockReturnValue(false);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "not_triggered",
        value: 5,
        threshold: 100,
        operator: "gt",
      });

      expect(handleSendEmail).not.toHaveBeenCalled();
      expect(updateAlert).toHaveBeenCalled();
    });
  });

  describe("when action is SEND_SLACK_MESSAGE", () => {
    it("calls handleSendSlackMessage with graph alert context", async () => {
      const trigger = {
        id: "trigger-1",
        name: "Test Alert",
        projectId: "project-1",
        customGraphId: "graph-1",
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          slackWebhook: "https://hooks.slack.com/test",
          seriesName: "0/count/count",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [{ name: "metric1", metric: "count", aggregation: "count" }],
        },
        filters: {},
      } as any);

      vi.mocked(timeseries).mockResolvedValue({
        currentPeriod: [{ "0/count/count": 15 }],
        previousPeriod: [],
      } as any);
      vi.mocked(checkThreshold).mockReturnValue(true);

      await processCustomGraphTrigger(trigger, mockProjects);

      expect(handleSendSlackMessage).toHaveBeenCalled();
    });
  });

  describe("when timeseries calculation uses average aggregation", () => {
    it("calculates current value as average of all values", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: "graph-1",
        action: TriggerAction.SEND_EMAIL,
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/count/avg",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [
            {
              name: "metric1",
              metric: "count",
              aggregation: "avg",
            },
          ],
        },
        filters: {},
      } as any);

      vi.mocked(timeseries).mockResolvedValue({
        currentPeriod: [
          { "0/count/avg": 10 },
          { "0/count/avg": 20 },
          { "0/count/avg": 30 },
        ],
        previousPeriod: [],
      } as any);

      vi.mocked(checkThreshold).mockReturnValue(false);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result.value).toBe(20); // (10 + 20 + 30) / 3
    });
  });

  describe("when timeseries returns no data", () => {
    it("sets current value to 0", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: "graph-1",
        action: TriggerAction.SEND_EMAIL,
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/count/count",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [{ name: "metric1", metric: "count", aggregation: "count" }],
        },
        filters: {},
      } as any);

      vi.mocked(timeseries).mockResolvedValue({
        currentPeriod: [],
        previousPeriod: [],
      } as any);
      vi.mocked(checkThreshold).mockReturnValue(false);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result.value).toBe(0);
    });
  });

  describe("when project is not found", () => {
    it("returns error status with message", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "unknown-project",
        customGraphId: "graph-1",
        action: TriggerAction.SEND_EMAIL,
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/count/count",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockResolvedValue({
        id: "graph-1",
        name: "Test Graph",
        graph: {
          series: [{ name: "metric1", metric: "count", aggregation: "count" }],
        },
        filters: {},
      } as any);

      vi.mocked(timeseries).mockResolvedValue({
        currentPeriod: [{ "0/count/count": 15 }],
        previousPeriod: [],
      } as any);
      vi.mocked(checkThreshold).mockReturnValue(true);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "error",
        message: "Project not found",
      });
    });
  });

  describe("when an exception occurs", () => {
    it("captures exception and returns error status", async () => {
      const error = new Error("Database error");
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        customGraphId: "graph-1",
        actionParams: {
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/count/count",
        },
      } as unknown as Trigger;

      vi.mocked(prisma.customGraph.findUnique).mockRejectedValue(error);

      const result = await processCustomGraphTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "error",
        message: "Database error",
      });

      expect(captureException).toHaveBeenCalledWith(error, {
        extra: {
          triggerId: "trigger-1",
          projectId: "project-1",
          type: "customGraphAlert",
        },
      });
    });
  });
});
