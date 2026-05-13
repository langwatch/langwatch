import { describe, expect, it, vi } from "vitest";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  LANGY_TOOL_OUTPUT_INVALID_CODE,
  langyToolErrorEnvelope,
} from "../../defineLangyTool";
import {
  makeGetDatasetDetails,
  makeListDatasets,
  makeProposeAddDatasetRows,
  makeProposeCreateDataset,
} from "../datasets";
import { ConversationToolIdSet } from "../../toolIdValidator";
import type { LangyToolContext } from "../types";

function makeCtx(opts: {
  datasetServiceLike?: Record<string, unknown>;
  seenIds?: ConversationToolIdSet;
} = {}): LangyToolContext {
  return {
    projectId: "project-1",
    seenIds: opts.seenIds ?? new ConversationToolIdSet(),
    batchEvaluationService: {} as LangyToolContext["batchEvaluationService"],
    datasetService:
      (opts.datasetServiceLike ??
        {}) as unknown as LangyToolContext["datasetService"],
    evaluatorService: {} as LangyToolContext["evaluatorService"],
    experimentService: {} as LangyToolContext["experimentService"],
    projectService: {} as LangyToolContext["projectService"],
    promptService: {} as LangyToolContext["promptService"],
  };
}

function invokeTool(toolDef: unknown, input: unknown): Promise<unknown> {
  const exec = (toolDef as { execute: (i: unknown) => Promise<unknown> })
    .execute;
  return exec(input);
}

function expectInvalidEnvelope(result: unknown) {
  expect(langyToolErrorEnvelope.safeParse(result).success).toBe(true);
  expect((result as { error: { code: string } }).error.code).toBe(
    LANGY_TOOL_OUTPUT_INVALID_CODE,
  );
}

describe("list_datasets tool-output validation", () => {
  describe("when datasetService returns a row whose id is not a string", () => {
    it("returns the tool_output_invalid envelope", async () => {
      const datasetServiceLike = {
        listAllNonArchivedWithCounts: vi.fn().mockResolvedValueOnce([
          {
            id: 999,
            slug: "ds-1",
            name: "Dataset 1",
            columnTypes: [],
            _count: { datasetRecords: 0 },
          },
        ]),
      };
      const toolDef = makeListDatasets(makeCtx({ datasetServiceLike }));
      const result = await invokeTool(toolDef, {});

      expectInvalidEnvelope(result);
    });
  });

  describe("when datasetService returns a well-formed row", () => {
    it("returns the parsed items array", async () => {
      const datasetServiceLike = {
        listAllNonArchivedWithCounts: vi.fn().mockResolvedValueOnce([
          {
            id: "ds-1",
            slug: "ds-1-slug",
            name: "Dataset 1",
            columnTypes: [{ name: "col", type: "string" }],
            _count: { datasetRecords: 3 },
          },
        ]),
      };
      const toolDef = makeListDatasets(makeCtx({ datasetServiceLike }));
      const result = (await invokeTool(toolDef, {})) as {
        items: Array<{ id: string }>;
      };

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe("ds-1");
    });
  });
});

describe("get_dataset_details tool-output validation", () => {
  describe("when datasetService returns a dataset but sampleRows has malformed id", () => {
    it("returns the tool_output_invalid envelope", async () => {
      const datasetServiceLike = {
        findByIdNonArchivedWithCounts: vi.fn().mockResolvedValueOnce({
          id: "ds-1",
          slug: "ds-1",
          name: "ds-1",
          columnTypes: [],
          _count: { datasetRecords: 1 },
        }),
        listRecordsSample: vi
          .fn()
          .mockResolvedValueOnce([{ id: 42, entry: {} }]),
      };
      const toolDef = makeGetDatasetDetails(makeCtx({ datasetServiceLike }));
      const result = await invokeTool(toolDef, {
        datasetId: "ds-1",
        sampleRowLimit: 5,
      });

      expectInvalidEnvelope(result);
    });
  });

  describe("when the dataset is not found", () => {
    it("returns the error branch matching its union variant", async () => {
      const datasetServiceLike = {
        findByIdNonArchivedWithCounts: vi.fn().mockResolvedValueOnce(null),
      };
      const toolDef = makeGetDatasetDetails(makeCtx({ datasetServiceLike }));
      const result = (await invokeTool(toolDef, {
        datasetId: "missing",
        sampleRowLimit: 0,
      })) as { error?: string };

      expect(result.error).toContain("No dataset found");
      expect(langyToolErrorEnvelope.safeParse(result).success).toBe(false);
    });
  });
});

describe("propose_create_dataset tool-output validation", () => {
  describe("when the proposal is well-formed", () => {
    it("returns the proposal envelope", async () => {
      const toolDef = makeProposeCreateDataset(makeCtx());
      const result = (await invokeTool(toolDef, {
        name: "New Dataset",
        columns: [{ name: "col1", type: "string" as const }],
        rationale: "because",
      })) as { langyProposal: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.kind).toBe("datasets.create");
    });
  });
});

describe("propose_add_dataset_rows tool-output validation", () => {
  describe("when the dataset id was not surfaced earlier", () => {
    it("returns the error branch matching its union variant", async () => {
      const toolDef = makeProposeAddDatasetRows(makeCtx());
      const result = (await invokeTool(toolDef, {
        datasetId: "ds-unsurfaced",
        rows: [{ col: "v" }],
        rationale: "r",
      })) as { error?: string };

      expect(result.error).toContain("not surfaced");
    });
  });

  describe("when the dataset is surfaced and exists", () => {
    it("returns the proposal envelope", async () => {
      const seen = new ConversationToolIdSet();
      seen.record("dataset_id", "ds-1");
      const datasetServiceLike = {
        findByIdNonArchivedWithCounts: vi.fn().mockResolvedValueOnce({
          id: "ds-1",
          name: "Dataset 1",
          slug: "ds-1",
        }),
      };
      const toolDef = makeProposeAddDatasetRows(
        makeCtx({ datasetServiceLike, seenIds: seen }),
      );
      const result = (await invokeTool(toolDef, {
        datasetId: "ds-1",
        rows: [{ col: "v" }],
        rationale: "r",
      })) as { langyProposal: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.kind).toBe("datasets.addRows");
    });
  });
});
