import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerContext } from "../../types";
import { handleAddToAnnotationQueue } from "../addToAnnotationQueue";

vi.mock("~/server/api/routers/annotation", () => ({
  createOrUpdateQueueItems: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {} as any,
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { prisma } from "~/server/db";
import { captureException } from "~/utils/posthogErrorCapture";

describe("handleAddToAnnotationQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when adding traces to annotation queue", () => {
    it("fetches full trigger and creates queue items with annotators", async () => {
      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          actionParams: {
            annotators: [
              { id: "user-1", name: "User 1" },
              { id: "user-2", name: "User 2" },
            ],
            createdByUserId: "creator-1",
          },
        } as any,
        projects: [],
        triggerData: [
          {
            input: "test input",
            output: "test output",
            traceId: "trace-1",
            projectId: "project-1",
            fullTrace: {} as any,
          },
          {
            input: "test input 2",
            output: "test output 2",
            traceId: "trace-2",
            projectId: "project-1",
            fullTrace: {} as any,
          },
        ],
        projectSlug: "test-project",
      };

      await handleAddToAnnotationQueue(context);

      expect(createOrUpdateQueueItems).toHaveBeenCalledTimes(2);
      expect(createOrUpdateQueueItems).toHaveBeenCalledWith({
        traceIds: ["trace-1"],
        projectId: "project-1",
        annotators: ["user-1", "user-2"],
        userId: "creator-1",
        prisma: prisma,
      });
      expect(createOrUpdateQueueItems).toHaveBeenCalledWith({
        traceIds: ["trace-2"],
        projectId: "project-1",
        annotators: ["user-1", "user-2"],
        userId: "creator-1",
        prisma: prisma,
      });
    });
  });

  describe("when action params has no annotators", () => {
    it("creates queue items with empty annotators list", async () => {
      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          actionParams: {},
        } as any,
        projects: [],
        triggerData: [
          {
            input: "",
            output: "",
            traceId: "trace-1",
            projectId: "project-1",
            fullTrace: {} as any,
          },
        ],
        projectSlug: "test-project",
      };

      await handleAddToAnnotationQueue(context);

      expect(createOrUpdateQueueItems).toHaveBeenCalledWith(
        expect.objectContaining({
          annotators: [],
        }),
      );
    });
  });

  describe("when action params has no createdByUserId", () => {
    it("creates queue items with empty string for userId", async () => {
      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          actionParams: {
            annotators: [{ id: "user-1", name: "User 1" }],
          },
        } as any,
        projects: [],
        triggerData: [
          {
            input: "",
            output: "",
            traceId: "trace-1",
            projectId: "project-1",
            fullTrace: {} as any,
          },
        ],
        projectSlug: "test-project",
      };

      await handleAddToAnnotationQueue(context);

      expect(createOrUpdateQueueItems).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "",
        }),
      );
    });
  });

  describe("when createOrUpdateQueueItems throws an error", () => {
    it("captures the exception with full context", async () => {
      const error = new Error("Queue creation failed");
      vi.mocked(createOrUpdateQueueItems).mockRejectedValue(error);

      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          actionParams: { annotators: [] },
        } as any,
        projects: [],
        triggerData: [
          {
            input: "",
            output: "",
            traceId: "trace-1",
            projectId: "project-1",
            fullTrace: {} as any,
          },
        ],
        projectSlug: "test-project",
      };

      await handleAddToAnnotationQueue(context);

      expect(captureException).toHaveBeenCalledWith(error, {
        extra: {
          triggerId: "trigger-1",
          projectId: "project-1",
          action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
        },
      });
    });
  });
});

