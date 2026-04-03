import { createServer, type Server } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initConfig } from "../config.js";

// --- Canned responses for dataset API endpoints ---

const CANNED_DATASETS_LIST = {
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
    {
      id: "ds_def456",
      name: "Training Data",
      slug: "training-data",
      columnTypes: [{ name: "prompt", type: "string" }],
      recordCount: 100,
      createdAt: "2025-01-03T00:00:00.000Z",
      updatedAt: "2025-01-04T00:00:00.000Z",
    },
  ],
  total: 2,
  page: 1,
  limit: 50,
};

const CANNED_DATASETS_EMPTY = {
  data: [],
  total: 0,
  page: 1,
  limit: 50,
};

const CANNED_DATASET_DETAIL = {
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

const CANNED_DATASET_CREATED = {
  id: "ds_new789",
  name: "Test Data",
  slug: "test-data",
  columnTypes: [
    { name: "input", type: "string" },
    { name: "output", type: "string" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const CANNED_DATASET_CREATED_EMPTY = {
  id: "ds_new790",
  name: "Empty Schema",
  slug: "empty-schema",
  columnTypes: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const CANNED_DATASET_UPDATED = {
  id: "ds_abc123",
  name: "New Name",
  slug: "new-name",
  columnTypes: [
    { name: "input", type: "string" },
    { name: "output", type: "string" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-05T00:00:00.000Z",
};

const CANNED_DATASET_UPDATED_COLUMNS = {
  id: "ds_abc123",
  name: "My Dataset",
  slug: "my-dataset",
  columnTypes: [{ name: "question", type: "string" }],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-05T00:00:00.000Z",
};

const CANNED_DATASET_ARCHIVED = {
  id: "ds_abc123",
  archived: true,
};

const CANNED_RECORDS_CREATED = {
  data: [
    { id: "rec-new-1", entry: { input: "hello", output: "world" } },
    { id: "rec-new-2", entry: { input: "foo", output: "bar" } },
  ],
};

const CANNED_RECORD_UPDATED = {
  id: "rec-123",
  entry: { input: "updated" },
};

const CANNED_RECORDS_DELETED = {
  deletedCount: 2,
};

// --- Mock HTTP Server ---

let emptyListMode = false;

function createMockServer(): Server {
  return createServer((req, res) => {
    const authToken = req.headers["x-auth-token"];
    if (authToken !== "test-integration-key") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Invalid auth token." }));
      return;
    }

    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");

      // GET /api/dataset - list datasets
      if (url.match(/^\/api\/dataset(\?|$)/) && req.method === "GET") {
        if (emptyListMode) {
          res.writeHead(200);
          res.end(JSON.stringify(CANNED_DATASETS_EMPTY));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify(CANNED_DATASETS_LIST));
        }
      }
      // GET /api/dataset/my-dataset - get dataset detail
      else if (
        url.match(/^\/api\/dataset\/my-dataset(\?|$)/) &&
        req.method === "GET"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_DATASET_DETAIL));
      }
      // GET /api/dataset/does-not-exist - not found
      else if (
        url.match(/^\/api\/dataset\/does-not-exist(\?|$)/) &&
        req.method === "GET"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Dataset not found" }));
      }
      // POST /api/dataset - create dataset
      else if (url === "/api/dataset" && req.method === "POST") {
        const parsed = JSON.parse(body);
        if (
          parsed.columnTypes &&
          Array.isArray(parsed.columnTypes) &&
          parsed.columnTypes.length > 0
        ) {
          res.writeHead(201);
          res.end(JSON.stringify(CANNED_DATASET_CREATED));
        } else {
          res.writeHead(201);
          res.end(JSON.stringify(CANNED_DATASET_CREATED_EMPTY));
        }
      }
      // PATCH /api/dataset/old-name - update dataset name
      else if (
        url.match(/^\/api\/dataset\/old-name$/) &&
        req.method === "PATCH"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_DATASET_UPDATED));
      }
      // PATCH /api/dataset/my-dataset - update dataset columns
      else if (
        url.match(/^\/api\/dataset\/my-dataset$/) &&
        req.method === "PATCH"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_DATASET_UPDATED_COLUMNS));
      }
      // PATCH /api/dataset/ghost - not found
      else if (
        url.match(/^\/api\/dataset\/ghost$/) &&
        req.method === "PATCH"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Dataset not found" }));
      }
      // DELETE /api/dataset/to-delete - archive dataset
      else if (
        url.match(/^\/api\/dataset\/to-delete$/) &&
        req.method === "DELETE"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_DATASET_ARCHIVED));
      }
      // DELETE /api/dataset/ghost - not found
      else if (
        url.match(/^\/api\/dataset\/ghost$/) &&
        req.method === "DELETE"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Dataset not found" }));
      }
      // POST /api/dataset/my-dataset/records - create records
      else if (
        url.match(/^\/api\/dataset\/my-dataset\/records$/) &&
        req.method === "POST"
      ) {
        res.writeHead(201);
        res.end(JSON.stringify(CANNED_RECORDS_CREATED));
      }
      // POST /api/dataset/ghost/records - not found
      else if (
        url.match(/^\/api\/dataset\/ghost\/records$/) &&
        req.method === "POST"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Dataset not found" }));
      }
      // PATCH /api/dataset/my-dataset/records/rec-123 - update record
      else if (
        url.match(/^\/api\/dataset\/my-dataset\/records\/rec-123$/) &&
        req.method === "PATCH"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_RECORD_UPDATED));
      }
      // PATCH /api/dataset/ghost/records/rec-1 - not found
      else if (
        url.match(/^\/api\/dataset\/ghost\/records\//) &&
        req.method === "PATCH"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Dataset not found" }));
      }
      // DELETE /api/dataset/my-dataset/records - delete records
      else if (
        url.match(/^\/api\/dataset\/my-dataset\/records$/) &&
        req.method === "DELETE"
      ) {
        res.writeHead(200);
        res.end(JSON.stringify(CANNED_RECORDS_DELETED));
      }
      // DELETE /api/dataset/ghost/records - not found
      else if (
        url.match(/^\/api\/dataset\/ghost\/records$/) &&
        req.method === "DELETE"
      ) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Dataset not found" }));
      } else {
        res.writeHead(404);
        res.end(
          JSON.stringify({ message: `Not found: ${req.method} ${url}` }),
        );
      }
    });
  });
}

// --- Integration Tests ---

describe("MCP dataset tools integration", () => {
  let server: Server;
  let port: number;

  beforeEach(() => {
    emptyListMode = false;
  });

  beforeAll(async () => {
    server = createMockServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        initConfig({
          apiKey: "test-integration-key",
          endpoint: `http://localhost:${port}`,
        });
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── List Datasets ──────────────────────────────────────────────

  describe("platform_list_datasets", () => {
    describe("when the project has datasets", () => {
      it("returns a formatted list showing both datasets with their names, slugs, and record counts", async () => {
        const { handleListDatasets } = await import(
          "../tools/list-datasets.js"
        );
        const result = await handleListDatasets();
        expect(result).toContain("User Feedback");
        expect(result).toContain("Training Data");
        expect(result).toContain("user-feedback");
        expect(result).toContain("training-data");
        expect(result).toContain("25");
        expect(result).toContain("100");
      });
    });

    describe("when the project has no datasets", () => {
      it("returns a helpful message indicating no datasets were found", async () => {
        emptyListMode = true;
        const { handleListDatasets } = await import(
          "../tools/list-datasets.js"
        );
        const result = await handleListDatasets();
        expect(result).toContain("No datasets found");
      });

      it("suggests using platform_create_dataset", async () => {
        emptyListMode = true;
        const { handleListDatasets } = await import(
          "../tools/list-datasets.js"
        );
        const result = await handleListDatasets();
        expect(result).toContain("platform_create_dataset");
      });
    });
  });

  // ── Get Dataset ────────────────────────────────────────────────

  describe("platform_get_dataset", () => {
    describe("when the dataset exists", () => {
      it("returns the dataset name, slug, and column definitions", async () => {
        const { handleGetDataset } = await import(
          "../tools/get-dataset.js"
        );
        const result = await handleGetDataset({ slugOrId: "my-dataset" });
        expect(result).toContain("My Dataset");
        expect(result).toContain("my-dataset");
        expect(result).toContain("input");
        expect(result).toContain("output");
      });

      it("returns a preview of records", async () => {
        const { handleGetDataset } = await import(
          "../tools/get-dataset.js"
        );
        const result = await handleGetDataset({ slugOrId: "my-dataset" });
        expect(result).toContain("hello");
        expect(result).toContain("world");
      });
    });

    describe("when the dataset does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleGetDataset } = await import(
          "../tools/get-dataset.js"
        );
        await expect(
          handleGetDataset({ slugOrId: "does-not-exist" }),
        ).rejects.toThrow("404");
      });
    });
  });

  // ── Create Dataset ─────────────────────────────────────────────

  describe("platform_create_dataset", () => {
    describe("when creating with name and columns", () => {
      it("returns confirmation including the generated slug", async () => {
        const { handleCreateDataset } = await import(
          "../tools/create-dataset.js"
        );
        const result = await handleCreateDataset({
          name: "Test Data",
          columnTypes: [
            { name: "input", type: "string" },
            { name: "output", type: "string" },
          ],
        });
        expect(result).toContain("test-data");
        expect(result).toContain("created");
      });
    });

    describe("when creating with only a name", () => {
      it("returns confirmation including the slug", async () => {
        const { handleCreateDataset } = await import(
          "../tools/create-dataset.js"
        );
        const result = await handleCreateDataset({
          name: "Empty Schema",
        });
        expect(result).toContain("empty-schema");
        expect(result).toContain("created");
      });
    });
  });

  // ── Update Dataset ─────────────────────────────────────────────

  describe("platform_update_dataset", () => {
    describe("when updating the dataset name", () => {
      it("returns confirmation reflecting the new name", async () => {
        const { handleUpdateDataset } = await import(
          "../tools/update-dataset.js"
        );
        const result = await handleUpdateDataset({
          slugOrId: "old-name",
          name: "New Name",
        });
        expect(result).toContain("New Name");
        expect(result).toContain("updated");
      });
    });

    describe("when updating dataset column types", () => {
      it("returns confirmation reflecting the new columns", async () => {
        const { handleUpdateDataset } = await import(
          "../tools/update-dataset.js"
        );
        const result = await handleUpdateDataset({
          slugOrId: "my-dataset",
          columnTypes: [{ name: "question", type: "string" }],
        });
        expect(result).toContain("question");
        expect(result).toContain("updated");
      });
    });

    describe("when the dataset does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleUpdateDataset } = await import(
          "../tools/update-dataset.js"
        );
        await expect(
          handleUpdateDataset({ slugOrId: "ghost", name: "Whatever" }),
        ).rejects.toThrow("404");
      });
    });
  });

  // ── Delete Dataset ─────────────────────────────────────────────

  describe("platform_delete_dataset", () => {
    describe("when the dataset exists", () => {
      it("returns confirmation that the dataset was deleted", async () => {
        const { handleDeleteDataset } = await import(
          "../tools/delete-dataset.js"
        );
        const result = await handleDeleteDataset({ slugOrId: "to-delete" });
        expect(result).toContain("deleted");
      });
    });

    describe("when the dataset does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleDeleteDataset } = await import(
          "../tools/delete-dataset.js"
        );
        await expect(
          handleDeleteDataset({ slugOrId: "ghost" }),
        ).rejects.toThrow("404");
      });
    });
  });

  // ── Create Records ─────────────────────────────────────────────

  describe("platform_create_dataset_records", () => {
    describe("when the dataset exists", () => {
      it("returns confirmation with the count of records created", async () => {
        const { handleCreateDatasetRecords } = await import(
          "../tools/create-dataset-records.js"
        );
        const result = await handleCreateDatasetRecords({
          slugOrId: "my-dataset",
          entries: [
            { input: "hello", output: "world" },
            { input: "foo", output: "bar" },
          ],
        });
        expect(result).toContain("2");
        expect(result).toContain("created");
      });
    });

    describe("when the dataset does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleCreateDatasetRecords } = await import(
          "../tools/create-dataset-records.js"
        );
        await expect(
          handleCreateDatasetRecords({
            slugOrId: "ghost",
            entries: [{ input: "hello" }],
          }),
        ).rejects.toThrow("404");
      });
    });
  });

  // ── Update Record ──────────────────────────────────────────────

  describe("platform_update_dataset_record", () => {
    describe("when the record exists", () => {
      it("returns confirmation that the record was updated", async () => {
        const { handleUpdateDatasetRecord } = await import(
          "../tools/update-dataset-record.js"
        );
        const result = await handleUpdateDatasetRecord({
          slugOrId: "my-dataset",
          recordId: "rec-123",
          entry: { input: "updated" },
        });
        expect(result).toContain("updated");
      });
    });

    describe("when the dataset does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleUpdateDatasetRecord } = await import(
          "../tools/update-dataset-record.js"
        );
        await expect(
          handleUpdateDatasetRecord({
            slugOrId: "ghost",
            recordId: "rec-1",
            entry: { input: "x" },
          }),
        ).rejects.toThrow("404");
      });
    });
  });

  // ── Delete Records ─────────────────────────────────────────────

  describe("platform_delete_dataset_records", () => {
    describe("when the dataset exists", () => {
      it("returns confirmation with the count of records deleted", async () => {
        const { handleDeleteDatasetRecords } = await import(
          "../tools/delete-dataset-records.js"
        );
        const result = await handleDeleteDatasetRecords({
          slugOrId: "my-dataset",
          recordIds: ["rec-1", "rec-2"],
        });
        expect(result).toContain("2");
        expect(result).toContain("deleted");
      });
    });

    describe("when the dataset does not exist", () => {
      it("propagates the 404 error", async () => {
        const { handleDeleteDatasetRecords } = await import(
          "../tools/delete-dataset-records.js"
        );
        await expect(
          handleDeleteDatasetRecords({
            slugOrId: "ghost",
            recordIds: ["rec-1"],
          }),
        ).rejects.toThrow("404");
      });
    });
  });
});
