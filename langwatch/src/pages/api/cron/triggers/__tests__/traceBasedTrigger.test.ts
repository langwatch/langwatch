import { type Project, type Trigger, TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processTraceBasedTrigger } from "../traceBasedTrigger";

const mockTraceService = {
  getAllTracesForProject: vi.fn(),
};

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: {
    create: vi.fn(() => mockTraceService),
  },
}));

vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: vi.fn().mockResolvedValue({
    canSeeCosts: true,
    canSeeCapturedInput: true,
    canSeeCapturedOutput: true,
  }),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("../actions/sendEmail", () => ({
  handleSendEmail: vi.fn(),
}));

vi.mock("../actions/sendSlackMessage", () => ({
  handleSendSlackMessage: vi.fn(),
}));

vi.mock("../actions/addToAnnotationQueue", () => ({
  handleAddToAnnotationQueue: vi.fn(),
}));

vi.mock("../actions/addToDataset", () => ({
  handleAddToDataset: vi.fn(),
}));

vi.mock("../utils", () => ({
  addTriggersSent: vi.fn(),
  getLatestUpdatedAt: vi.fn(() => 1234567890),
  triggerSentForMany: vi.fn(() => []),
  updateAlert: vi.fn(),
}));

import { handleAddToAnnotationQueue } from "../actions/addToAnnotationQueue";
import { handleAddToDataset } from "../actions/addToDataset";
import { handleSendEmail } from "../actions/sendEmail";
import { handleSendSlackMessage } from "../actions/sendSlackMessage";
import {
  addTriggersSent,
  getLatestUpdatedAt,
  triggerSentForMany,
  updateAlert,
} from "../utils";

describe("processTraceBasedTrigger", () => {
  const mockProjects: Project[] = [
    { id: "project-1", slug: "test-project" } as Project,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when trigger has matching traces", () => {
    it("returns triggered status with trace count", async () => {
      const trigger = {
        id: "trigger-1",
        name: "Test Trigger",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: [] },
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [
          [
            {
              trace_id: "trace-1",
              input: { value: "test input" },
              output: { value: "test output" },
              timestamps: { updated_at: 1000 },
            },
          ],
          [
            {
              trace_id: "trace-2",
              input: { value: "test input 2" },
              output: { value: "test output 2" },
              timestamps: { updated_at: 2000 },
            },
          ],
        ],
        totalHits: 2,
        traceChecks: {},
      });

      vi.mocked(triggerSentForMany).mockResolvedValue([]);

      const result = await processTraceBasedTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        updatedAt: 1234567890,
        status: "triggered",
        totalFound: 2,
      });
    });

    it("creates trigger sent records for all matched traces", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_EMAIL,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [
          [
            {
              trace_id: "trace-1",
              input: { value: "" },
              output: { value: "" },
              timestamps: { updated_at: 1000 },
            },
          ],
        ],
        totalHits: 1,
        traceChecks: {},
      });

      vi.mocked(triggerSentForMany).mockResolvedValue([]);

      await processTraceBasedTrigger(trigger, mockProjects);

      expect(addTriggersSent).toHaveBeenCalledWith(
        "trigger-1",
        expect.arrayContaining([
          expect.objectContaining({
            traceId: "trace-1",
            projectId: "project-1",
          }),
        ]),
      );
    });

    it("updates the trigger lastRunAt timestamp", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_EMAIL,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [
          [
            {
              trace_id: "trace-1",
              timestamps: { updated_at: 1000 },
            },
          ],
        ],
        totalHits: 1,
        traceChecks: {},
      });

      vi.mocked(triggerSentForMany).mockResolvedValue([]);

      await processTraceBasedTrigger(trigger, mockProjects);

      expect(updateAlert).toHaveBeenCalledWith(
        "trigger-1",
        1234567890,
        "project-1",
      );
    });
  });

  describe("when trigger action is SEND_EMAIL", () => {
    it("calls handleSendEmail with correct context", async () => {
      const trigger = {
        id: "trigger-1",
        name: "Email Trigger",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["user@example.com"] },
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [[{ trace_id: "trace-1", timestamps: { updated_at: 1000 } }]],
        totalHits: 1,
        traceChecks: {},
      });

      await processTraceBasedTrigger(trigger, mockProjects);

      expect(handleSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger,
          projectSlug: "test-project",
        }),
      );
    });
  });

  describe("when trigger action is SEND_SLACK_MESSAGE", () => {
    it("calls handleSendSlackMessage with correct context", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [[{ trace_id: "trace-1", timestamps: { updated_at: 1000 } }]],
        totalHits: 1,
        traceChecks: {},
      });

      await processTraceBasedTrigger(trigger, mockProjects);

      expect(handleSendSlackMessage).toHaveBeenCalled();
    });
  });

  describe("when trigger action is ADD_TO_ANNOTATION_QUEUE", () => {
    it("calls handleAddToAnnotationQueue with correct context", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [[{ trace_id: "trace-1", timestamps: { updated_at: 1000 } }]],
        totalHits: 1,
        traceChecks: {},
      });

      await processTraceBasedTrigger(trigger, mockProjects);

      expect(handleAddToAnnotationQueue).toHaveBeenCalled();
    });
  });

  describe("when trigger action is ADD_TO_DATASET", () => {
    it("calls handleAddToDataset with correct context", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [[{ trace_id: "trace-1", timestamps: { updated_at: 1000 } }]],
        totalHits: 1,
        traceChecks: {},
      });

      await processTraceBasedTrigger(trigger, mockProjects);

      expect(handleAddToDataset).toHaveBeenCalled();
    });
  });

  describe("when no matching traces are found", () => {
    it("returns not_triggered status", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_EMAIL,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [],
        totalHits: 0,
        traceChecks: {},
      });

      const result = await processTraceBasedTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        updatedAt: 0,
        status: "not_triggered",
      });
    });

    it("does not create any trigger sent records", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_EMAIL,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [],
        totalHits: 0,
        traceChecks: {},
      });

      await processTraceBasedTrigger(trigger, mockProjects);

      expect(addTriggersSent).not.toHaveBeenCalled();
    });
  });

  describe("when traces were already sent", () => {
    it("filters out previously sent traces", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "project-1",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_EMAIL,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [
          [
            {
              trace_id: "trace-1",
              timestamps: { updated_at: 1000 },
            },
          ],
          [
            {
              trace_id: "trace-2",
              timestamps: { updated_at: 2000 },
            },
          ],
        ],
        totalHits: 2,
        traceChecks: {},
      });

      vi.mocked(triggerSentForMany).mockResolvedValue([
        { traceId: "trace-1" } as any,
      ]);

      const result = await processTraceBasedTrigger(trigger, mockProjects);

      expect(result.totalFound).toBe(1);
      expect(addTriggersSent).toHaveBeenCalledWith(
        "trigger-1",
        expect.arrayContaining([
          expect.objectContaining({
            traceId: "trace-2",
          }),
        ]),
      );
    });
  });

  describe("when project is not found", () => {
    it("returns error status with message", async () => {
      const trigger = {
        id: "trigger-1",
        projectId: "unknown-project",
        filters: JSON.stringify({}),
        lastRunAt: 0,
        action: TriggerAction.SEND_EMAIL,
        actionParams: {},
      } as unknown as Trigger;

      mockTraceService.getAllTracesForProject.mockResolvedValue({
        groups: [
          [
            {
              trace_id: "trace-1",
              input: { value: "test" },
              output: { value: "test" },
              timestamps: { updated_at: 1000 },
            },
          ],
        ],
        totalHits: 1,
        traceChecks: {},
      });

      vi.mocked(triggerSentForMany).mockResolvedValue([]);

      const result = await processTraceBasedTrigger(trigger, mockProjects);

      expect(result).toEqual({
        triggerId: "trigger-1",
        status: "error",
        message: "Project not found",
      });
    });
  });
});
