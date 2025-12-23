import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerContext } from "../../types";
import { handleAddToDataset } from "../addToDataset";

vi.mock("~/server/api/routers/datasetRecord", () => ({
  createManyDatasetRecords: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("~/server/tracer/tracesMapping", () => ({
  mapTraceToDatasetEntry: vi.fn(),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord";
import { mapTraceToDatasetEntry } from "~/server/tracer/tracesMapping";
import { captureException } from "~/utils/posthogErrorCapture";

describe("handleAddToDataset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when adding traces to dataset", () => {
    let context: TriggerContext;

    beforeEach(() => {
      vi.mocked(mapTraceToDatasetEntry).mockReturnValue([
        { field1: "value1", field2: "value2" },
      ]);

      context = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          actionParams: {
            datasetId: "dataset-1",
            datasetMapping: {
              mapping: { field1: { source: "input", key: "value", subkey: "" } },
              expansions: ["input", "output"],
            },
          },
        } as any,
        projects: [],
        triggerData: [
          {
            input: "test input",
            output: "test output",
            traceId: "trace-1",
            projectId: "project-1",
            fullTrace: { trace_id: "trace-1" } as any,
          },
        ],
        projectSlug: "test-project",
      };
    });

    it("maps traces to dataset entries", async () => {
      await handleAddToDataset(context);

      expect(mapTraceToDatasetEntry).toHaveBeenCalled();
    });

    it("creates dataset records with mapped entries", async () => {
      await handleAddToDataset(context);

      expect(createManyDatasetRecords).toHaveBeenCalledWith({
        datasetId: "dataset-1",
        projectId: "project-1",
        datasetRecords: expect.arrayContaining([
          expect.objectContaining({
            field1: "value1",
            field2: "value2",
            selected: true,
          }),
        ]),
      });
    });
  });

  describe("when entry contains string with null bytes", () => {
    it("removes null bytes from the string", async () => {
      vi.mocked(mapTraceToDatasetEntry).mockReturnValue([
        { field1: "test\u0000value", field2: "clean\u0000\u0000data" },
      ]);

      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          actionParams: {
            datasetId: "dataset-1",
            datasetMapping: {
              mapping: {},
              expansions: [],
            },
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

      await handleAddToDataset(context);

      expect(createManyDatasetRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetRecords: expect.arrayContaining([
            expect.objectContaining({
              field1: "testvalue",
              field2: "cleandata",
            }),
          ]),
        }),
      );
    });
  });

  describe("when entry contains non-string values", () => {
    it("preserves the value unchanged", async () => {
      vi.mocked(mapTraceToDatasetEntry).mockReturnValue([
        { number: 42, boolean: "true", object: '{"nested":"value"}' },
      ]);

      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          actionParams: {
            datasetId: "dataset-1",
            datasetMapping: {
              mapping: {},
              expansions: [],
            },
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

      await handleAddToDataset(context);

      expect(createManyDatasetRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetRecords: expect.arrayContaining([
            expect.objectContaining({
              number: 42,
              boolean: "true",
              object: '{"nested":"value"}',
            }),
          ]),
        }),
      );
    });
  });

  describe("when createManyDatasetRecords throws an error", () => {
    it("captures the exception with full context", async () => {
      const error = new Error("Dataset creation failed");
      vi.mocked(mapTraceToDatasetEntry).mockReturnValue([{}]);
      vi.mocked(createManyDatasetRecords).mockRejectedValue(error);

      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          actionParams: {
            datasetId: "dataset-1",
            datasetMapping: { mapping: {}, expansions: [] },
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

      await handleAddToDataset(context);

      expect(captureException).toHaveBeenCalledWith(error, {
        extra: {
          triggerId: "trigger-1",
          projectId: "project-1",
          action: TriggerAction.ADD_TO_DATASET,
        },
      });
    });
  });
});
