import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api-datasets.js", () => ({
  listDatasets: vi.fn(),
  getDataset: vi.fn(),
}));

import { listDatasets, getDataset } from "../langwatch-api-datasets.js";

import { handleListDatasets } from "../tools/list-datasets.js";
import { handleGetDataset } from "../tools/get-dataset.js";
import { formatDatasetResponse } from "../tools/get-dataset.js";
import { createDatasetSchema } from "../schemas/create-dataset.js";

const mockListDatasets = vi.mocked(listDatasets);
const mockGetDataset = vi.mocked(getDataset);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── formatDatasetResponse ────────────────────────────────────────

describe("formatDatasetResponse()", () => {
  const sampleDataset = {
    id: "ds_abc123",
    name: "My Dataset",
    slug: "my-dataset",
    columnTypes: [
      { name: "input", type: "string" },
      { name: "output", type: "string" },
    ],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    data: [
      { id: "rec-1", entry: { input: "hello", output: "world" } },
      { id: "rec-2", entry: { input: "foo", output: "bar" } },
    ],
  };

  describe("when given a dataset with columns and records", () => {
    let result: string;

    beforeEach(() => {
      result = formatDatasetResponse(sampleDataset);
    });

    it("includes the dataset name in the heading", () => {
      expect(result).toContain("# Dataset: My Dataset");
    });

    it("includes the slug", () => {
      expect(result).toContain("my-dataset");
    });

    it("includes a column table", () => {
      expect(result).toContain("input");
      expect(result).toContain("output");
      expect(result).toContain("string");
    });

    it("includes record entries", () => {
      expect(result).toContain("hello");
      expect(result).toContain("world");
      expect(result).toContain("foo");
      expect(result).toContain("bar");
    });

    it("includes record IDs", () => {
      expect(result).toContain("rec-1");
      expect(result).toContain("rec-2");
    });
  });

  describe("when given a dataset with no records", () => {
    it("indicates no records", () => {
      const result = formatDatasetResponse({
        ...sampleDataset,
        data: [],
      });
      expect(result).toContain("No records");
    });
  });
});

// ── handleListDatasets ──────────────────────────────────────────

describe("handleListDatasets()", () => {
  const sampleListResponse = {
    data: [
      {
        id: "ds_abc123",
        name: "User Feedback",
        slug: "user-feedback",
        columnTypes: [
          { name: "input", type: "string" },
          { name: "output", type: "string" },
        ],
        recordCount: 25,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ],
    pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
  };

  describe("when format is digest (default)", () => {
    it("returns markdown containing dataset names", async () => {
      mockListDatasets.mockResolvedValue(sampleListResponse);
      const result = await handleListDatasets();
      expect(result).toContain("User Feedback");
      expect(result).toContain("user-feedback");
    });
  });

  describe("when format is json", () => {
    it("returns valid parseable JSON containing all datasets and total", async () => {
      mockListDatasets.mockResolvedValue(sampleListResponse);
      const result = await handleListDatasets({ format: "json" });
      const parsed = JSON.parse(result);
      expect(parsed.data).toEqual(sampleListResponse.data);
      expect(parsed.total).toBe(sampleListResponse.pagination.total);
    });
  });

  describe("when no datasets exist", () => {
    it("returns a no-datasets message in digest mode", async () => {
      mockListDatasets.mockResolvedValue({ data: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 } });
      const result = await handleListDatasets();
      expect(result).toContain("No datasets found");
    });
  });
});

// ── handleGetDataset ────────────────────────────────────────────

describe("handleGetDataset()", () => {
  const sampleDataset = {
    id: "ds_abc123",
    name: "My Dataset",
    slug: "my-dataset",
    columnTypes: [
      { name: "input", type: "string" },
      { name: "output", type: "string" },
    ],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    data: [
      { id: "rec-1", entry: { input: "hello", output: "world" } },
    ],
  };

  describe("when format is digest (default)", () => {
    it("returns markdown containing dataset name", async () => {
      mockGetDataset.mockResolvedValue(sampleDataset);
      const result = await handleGetDataset({ slugOrId: "my-dataset" });
      expect(result).toContain("# Dataset: My Dataset");
    });
  });

  describe("when format is json", () => {
    it("returns valid parseable JSON matching the dataset structure", async () => {
      mockGetDataset.mockResolvedValue(sampleDataset);
      const result = await handleGetDataset({ slugOrId: "my-dataset", format: "json" });
      expect(JSON.parse(result)).toEqual(sampleDataset);
    });
  });
});

// ── platform_create_dataset schema validation ────────────────────

describe("platform_create_dataset schema", () => {
  describe("when input has no name", () => {
    it("rejects the input with a validation error", () => {
      const result = createDatasetSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("when input has an empty name", () => {
    it("rejects the input with a validation error", () => {
      const result = createDatasetSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("when input has a valid name", () => {
    it("accepts the input", () => {
      const result = createDatasetSchema.safeParse({ name: "Test" });
      expect(result.success).toBe(true);
    });
  });
});

// ── Tool Registration ────────────────────────────────────────────

describe("MCP server dataset tool registration", () => {
  describe("when the MCP server is created", () => {
    it("registers all 8 dataset tools", async () => {
      const { createMcpServer } = await import("../create-mcp-server.js");
      const server = createMcpServer();
      // Access registered tools via the internal _registeredTools object
      const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
      const toolNames = Object.keys(registeredTools);

      expect(toolNames).toContain("platform_list_datasets");
      expect(toolNames).toContain("platform_get_dataset");
      expect(toolNames).toContain("platform_create_dataset");
      expect(toolNames).toContain("platform_update_dataset");
      expect(toolNames).toContain("platform_delete_dataset");
      expect(toolNames).toContain("platform_create_dataset_records");
      expect(toolNames).toContain("platform_update_dataset_record");
      expect(toolNames).toContain("platform_delete_dataset_records");
    });
  });
});

// ── API Key Requirement ──────────────────────────────────────────

describe("dataset tools API key requirement", () => {
  describe("when no API key is configured", () => {
    it("requireApiKey throws when apiKey is empty", async () => {
      const savedKey = process.env.LANGWATCH_API_KEY;
      delete process.env.LANGWATCH_API_KEY;

      try {
        const { initConfig, requireApiKey } = await import("../config.js");
        initConfig({ apiKey: "", endpoint: "http://localhost:0" });

        expect(() => requireApiKey()).toThrow(
          "LANGWATCH_API_KEY is required",
        );
      } finally {
        if (savedKey !== undefined) {
          process.env.LANGWATCH_API_KEY = savedKey;
        }
      }
    });
  });
});
