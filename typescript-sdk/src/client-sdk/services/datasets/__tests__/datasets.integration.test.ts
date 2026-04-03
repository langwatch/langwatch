/**
 * Integration tests for Dataset TypeScript SDK
 *
 * Tests all CRUD operations for datasets and records with mocked API boundaries (MSW).
 * Corresponds to @integration scenarios in specs/features/dataset-typescript-sdk.feature.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { LangWatch } from "@/client-sdk";
import { DatasetNotFoundError, DatasetApiError } from "../errors";

const TEST_ENDPOINT = "http://localhost:5560";

// -- Fixtures --

function datasetMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: "dataset_abc123",
    name: "my-data",
    slug: "my-data",
    columnTypes: [{ name: "input", type: "string" }],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function recordFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    datasetId: "dataset_abc123",
    projectId: "project_123",
    entry: { input: "hello", output: "world" },
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const server = setupServer();

describe("Feature: Dataset TypeScript SDK", () => {
  let langwatch: LangWatch;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
    langwatch = new LangWatch({
      apiKey: "test-api-key",
      endpoint: TEST_ENDPOINT,
    });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  // ── List Datasets ───────────────────────────────────────────────

  describe("list()", () => {
    describe("when the API returns a paginated list of 3 datasets", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/dataset`, () => {
            return HttpResponse.json({
              data: [
                datasetMetadata({ id: "d1", name: "ds-1", slug: "ds-1" }),
                datasetMetadata({ id: "d2", name: "ds-2", slug: "ds-2" }),
                datasetMetadata({ id: "d3", name: "ds-3", slug: "ds-3" }),
              ],
              total: 3,
              page: 1,
              limit: 50,
            });
          }),
        );
      });

      it("receives a response containing 3 datasets with id, name, slug, and columnTypes", async () => {
        const result = await langwatch.datasets.list();

        expect(result.data).toHaveLength(3);
        for (const dataset of result.data) {
          expect(dataset).toHaveProperty("id");
          expect(dataset).toHaveProperty("name");
          expect(dataset).toHaveProperty("slug");
          expect(dataset).toHaveProperty("columnTypes");
        }
      });
    });
  });

  // ── Create Dataset ──────────────────────────────────────────────

  describe("create()", () => {
    describe("when the API accepts the dataset creation payload", () => {
      let capturedBody: Record<string, unknown> | null = null;

      beforeEach(() => {
        capturedBody = null;
        server.use(
          http.post(`${TEST_ENDPOINT}/api/dataset`, async ({ request }) => {
            capturedBody = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json(
              datasetMetadata({ name: capturedBody?.name ?? "my-data" }),
              { status: 201 },
            );
          }),
        );
      });

      it("sends POST /api/dataset with name and columnTypes and returns dataset metadata", async () => {
        const result = await langwatch.datasets.create({
          name: "my-data",
          columnTypes: [{ name: "input", type: "string" }],
        });

        expect(capturedBody).toMatchObject({
          name: "my-data",
          columnTypes: [{ name: "input", type: "string" }],
        });

        expect(result).toHaveProperty("id");
        expect(result).toHaveProperty("name");
        expect(result).toHaveProperty("slug");
        expect(result).toHaveProperty("columnTypes");
      });
    });

    describe("when the API responds with 409 Conflict for a duplicate slug", () => {
      beforeEach(() => {
        server.use(
          http.post(`${TEST_ENDPOINT}/api/dataset`, () => {
            return HttpResponse.json(
              { error: "Conflict", message: "A dataset with this slug already exists" },
              { status: 409 },
            );
          }),
        );
      });

      it("throws a DatasetApiError with status 409", async () => {
        await expect(
          langwatch.datasets.create({ name: "existing-name" }),
        ).rejects.toThrow(DatasetApiError);

        await expect(
          langwatch.datasets.create({ name: "existing-name" }),
        ).rejects.toMatchObject({
          status: 409,
        });
      });
    });
  });

  // ── Get Dataset ─────────────────────────────────────────────────

  describe("get()", () => {
    describe("when the API returns a dataset with 5 records", () => {
      beforeEach(() => {
        const records = Array.from({ length: 5 }, (_, i) =>
          recordFixture({ id: `rec-${i}` }),
        );

        server.use(
          http.get(`${TEST_ENDPOINT}/api/dataset/:slugOrId`, () => {
            return HttpResponse.json({
              ...datasetMetadata(),
              data: records,
            });
          }),
        );
      });

      it("receives a dataset with 5 entries", async () => {
        const dataset = await langwatch.datasets.get("my-dataset");

        expect(dataset.entries).toHaveLength(5);
        expect(dataset).toHaveProperty("id");
        expect(dataset).toHaveProperty("name");
        expect(dataset).toHaveProperty("slug");
        expect(dataset).toHaveProperty("columnTypes");
      });
    });

    describe("when the API responds with 404", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/dataset/:slugOrId`, () => {
            return HttpResponse.json(
              { error: "Not Found", message: "Dataset not found" },
              { status: 404 },
            );
          }),
        );
      });

      it("throws a DatasetNotFoundError", async () => {
        await expect(
          langwatch.datasets.get("does-not-exist"),
        ).rejects.toThrow(DatasetNotFoundError);
      });
    });
  });

  // ── Update Dataset ──────────────────────────────────────────────

  describe("update()", () => {
    describe("when the API accepts the update payload and returns the updated dataset", () => {
      let capturedBody: Record<string, unknown> | null = null;
      let capturedPath: string | null = null;

      beforeEach(() => {
        capturedBody = null;
        capturedPath = null;
        server.use(
          http.patch(`${TEST_ENDPOINT}/api/dataset/:slugOrId`, async ({ request, params }) => {
            capturedBody = (await request.json()) as Record<string, unknown>;
            capturedPath = params.slugOrId as string;
            return HttpResponse.json(
              datasetMetadata({ name: "new-name", slug: "new-name" }),
            );
          }),
        );
      });

      it("sends PATCH /api/dataset/my-data with name and returns updated dataset", async () => {
        const result = await langwatch.datasets.update("my-data", { name: "new-name" });

        expect(capturedPath).toBe("my-data");
        expect(capturedBody).toMatchObject({ name: "new-name" });
        expect(result.name).toBe("new-name");
        expect(result.slug).toBe("new-name");
      });
    });

    describe("when the API responds with 404", () => {
      beforeEach(() => {
        server.use(
          http.patch(`${TEST_ENDPOINT}/api/dataset/:slugOrId`, () => {
            return HttpResponse.json(
              { error: "Not Found", message: "Dataset not found" },
              { status: 404 },
            );
          }),
        );
      });

      it("throws a DatasetNotFoundError", async () => {
        await expect(
          langwatch.datasets.update("ghost", { name: "x" }),
        ).rejects.toThrow(DatasetNotFoundError);
      });
    });
  });

  // ── Delete Dataset ──────────────────────────────────────────────

  describe("delete()", () => {
    describe("when the API accepts the delete request and returns the archived dataset", () => {
      let capturedPath: string | null = null;

      beforeEach(() => {
        capturedPath = null;
        server.use(
          http.delete(`${TEST_ENDPOINT}/api/dataset/:slugOrId`, ({ params }) => {
            capturedPath = params.slugOrId as string;
            return HttpResponse.json(datasetMetadata({ archivedAt: "2025-06-01T00:00:00Z" }));
          }),
        );
      });

      it("sends DELETE /api/dataset/my-data and returns the archived dataset", async () => {
        const result = await langwatch.datasets.delete("my-data");

        expect(capturedPath).toBe("my-data");
        expect(result).toHaveProperty("id");
        expect(result).toHaveProperty("name");
      });
    });

    describe("when the API responds with 404", () => {
      beforeEach(() => {
        server.use(
          http.delete(`${TEST_ENDPOINT}/api/dataset/:slugOrId`, () => {
            return HttpResponse.json(
              { error: "Not Found", message: "Dataset not found" },
              { status: 404 },
            );
          }),
        );
      });

      it("throws a DatasetNotFoundError", async () => {
        await expect(
          langwatch.datasets.delete("ghost"),
        ).rejects.toThrow(DatasetNotFoundError);
      });
    });
  });

  // ── Create Records (Batch) ──────────────────────────────────────

  describe("createRecords()", () => {
    describe("when the API accepts the batch create payload and returns created records", () => {
      let capturedBody: Record<string, unknown> | null = null;
      let capturedPath: string | null = null;

      beforeEach(() => {
        capturedBody = null;
        capturedPath = null;
        server.use(
          http.post(`${TEST_ENDPOINT}/api/dataset/:slugOrId/records`, async ({ request, params }) => {
            capturedBody = (await request.json()) as Record<string, unknown>;
            capturedPath = params.slugOrId as string;
            return HttpResponse.json(
              { data: [recordFixture()] },
              { status: 201 },
            );
          }),
        );
      });

      it("sends POST /api/dataset/my-data/records with entries and returns created records", async () => {
        const result = await langwatch.datasets.createRecords("my-data", [
          { input: "hello", output: "world" },
        ]);

        expect(capturedPath).toBe("my-data");
        expect(capturedBody).toMatchObject({
          entries: [{ input: "hello", output: "world" }],
        });
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toHaveProperty("id");
      });
    });

    describe("when the API responds with 404", () => {
      beforeEach(() => {
        server.use(
          http.post(`${TEST_ENDPOINT}/api/dataset/:slugOrId/records`, () => {
            return HttpResponse.json(
              { error: "Not Found", message: "Dataset not found" },
              { status: 404 },
            );
          }),
        );
      });

      it("throws a DatasetNotFoundError", async () => {
        await expect(
          langwatch.datasets.createRecords("ghost", [{ input: "x" }]),
        ).rejects.toThrow(DatasetNotFoundError);
      });
    });
  });

  // ── Update Record ───────────────────────────────────────────────

  describe("updateRecord()", () => {
    describe("when the API accepts the record update and returns the updated record", () => {
      let capturedBody: Record<string, unknown> | null = null;
      let capturedSlug: string | null = null;
      let capturedRecordId: string | null = null;

      beforeEach(() => {
        capturedBody = null;
        capturedSlug = null;
        capturedRecordId = null;
        server.use(
          http.patch(
            `${TEST_ENDPOINT}/api/dataset/:slugOrId/records/:recordId`,
            async ({ request, params }) => {
              capturedBody = (await request.json()) as Record<string, unknown>;
              capturedSlug = params.slugOrId as string;
              capturedRecordId = params.recordId as string;
              return HttpResponse.json(
                recordFixture({ entry: { input: "updated" } }),
              );
            },
          ),
        );
      });

      it("sends PATCH /api/dataset/my-data/records/rec-1 and returns updated record", async () => {
        const result = await langwatch.datasets.updateRecord("my-data", "rec-1", {
          input: "updated",
        });

        expect(capturedSlug).toBe("my-data");
        expect(capturedRecordId).toBe("rec-1");
        expect(capturedBody).toMatchObject({ entry: { input: "updated" } });
        expect(result.entry).toMatchObject({ input: "updated" });
      });
    });

    describe("when the API responds with 404", () => {
      beforeEach(() => {
        server.use(
          http.patch(
            `${TEST_ENDPOINT}/api/dataset/:slugOrId/records/:recordId`,
            () => {
              return HttpResponse.json(
                { error: "Not Found", message: "Dataset not found" },
                { status: 404 },
              );
            },
          ),
        );
      });

      it("throws a DatasetNotFoundError", async () => {
        await expect(
          langwatch.datasets.updateRecord("ghost", "rec-1", { input: "x" }),
        ).rejects.toThrow(DatasetNotFoundError);
      });
    });
  });

  // ── Delete Records ──────────────────────────────────────────────

  describe("deleteRecords()", () => {
    describe("when the API accepts the batch delete and returns deletedCount 2", () => {
      let capturedBody: Record<string, unknown> | null = null;
      let capturedPath: string | null = null;

      beforeEach(() => {
        capturedBody = null;
        capturedPath = null;
        server.use(
          http.delete(`${TEST_ENDPOINT}/api/dataset/:slugOrId/records`, async ({ request, params }) => {
            capturedBody = (await request.json()) as Record<string, unknown>;
            capturedPath = params.slugOrId as string;
            return HttpResponse.json({ deletedCount: 2 });
          }),
        );
      });

      it("sends DELETE /api/dataset/my-data/records with recordIds and returns deletedCount", async () => {
        const result = await langwatch.datasets.deleteRecords("my-data", [
          "rec-1",
          "rec-2",
        ]);

        expect(capturedPath).toBe("my-data");
        expect(capturedBody).toMatchObject({ recordIds: ["rec-1", "rec-2"] });
        expect(result.deletedCount).toBe(2);
      });
    });

    describe("when the API responds with 404", () => {
      beforeEach(() => {
        server.use(
          http.delete(`${TEST_ENDPOINT}/api/dataset/:slugOrId/records`, () => {
            return HttpResponse.json(
              { error: "Not Found", message: "Dataset not found" },
              { status: 404 },
            );
          }),
        );
      });

      it("throws a DatasetNotFoundError", async () => {
        await expect(
          langwatch.datasets.deleteRecords("ghost", ["rec-1"]),
        ).rejects.toThrow(DatasetNotFoundError);
      });
    });
  });

  // ── Upload File ─────────────────────────────────────────────────

  describe("upload()", () => {
    describe("when the API accepts the file upload and returns created records", () => {
      let capturedContentType: string | null = null;
      let capturedFormData: FormData | null = null;

      beforeEach(() => {
        capturedContentType = null;
        capturedFormData = null;
        server.use(
          http.post(
            `${TEST_ENDPOINT}/api/dataset/:slugOrId/upload`,
            async ({ request }) => {
              capturedContentType = request.headers.get("content-type");
              capturedFormData = await request.formData();
              return HttpResponse.json({
                records: [recordFixture()],
              });
            },
          ),
        );
      });

      it("sends POST /api/dataset/my-data/upload with multipart form data", async () => {
        const file = new File(["input,output\nhello,world"], "data.csv", {
          type: "text/csv",
        });

        const result = await langwatch.datasets.upload("my-data", file);

        expect(capturedContentType).toContain("multipart/form-data");
        expect(capturedFormData).not.toBeNull();
        expect(capturedFormData!.get("file")).toBeTruthy();
        expect(result.records).toHaveLength(1);
      });
    });

    describe("when the API responds with 404", () => {
      beforeEach(() => {
        server.use(
          http.post(`${TEST_ENDPOINT}/api/dataset/:slugOrId/upload`, () => {
            return HttpResponse.json(
              { error: "Not Found", message: "Dataset not found" },
              { status: 404 },
            );
          }),
        );
      });

      it("throws a DatasetNotFoundError", async () => {
        const file = new File(["data"], "data.csv", { type: "text/csv" });

        await expect(
          langwatch.datasets.upload("ghost", file),
        ).rejects.toThrow(DatasetNotFoundError);
      });
    });
  });
});
