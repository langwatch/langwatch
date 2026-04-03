import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("../langwatch-api-datasets.js", () => ({
  listDatasets: vi.fn(),
  getDataset: vi.fn(),
}));

import { listDatasets, getDataset } from "../langwatch-api-datasets.js";

import { handleListDatasets } from "../tools/list-datasets.js";
import { handleGetDataset } from "../tools/get-dataset.js";
import { formatDatasetResponse } from "../tools/get-dataset.js";

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

// ── platform_create_dataset schema validation ────────────────────

describe("platform_create_dataset schema", () => {
  const createDatasetSchema = z.object({
    name: z.string().min(1, "name is required"),
    columnTypes: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
        }),
      )
      .optional(),
  });

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
    it("returns an error indicating an API key is required", async () => {
      // Reset config to have no API key
      const { initConfig, requireApiKey } = await import("../config.js");
      initConfig({ apiKey: undefined, endpoint: "http://localhost:0" });

      expect(() => requireApiKey()).toThrow("LANGWATCH_API_KEY is required");
    });
  });
});
