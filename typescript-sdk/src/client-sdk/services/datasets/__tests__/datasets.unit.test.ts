/**
 * Unit tests for Dataset TypeScript SDK
 *
 * Tests facade method exposure, error mapping, pagination forwarding, and defaults.
 * Corresponds to @unit scenarios in specs/features/dataset-typescript-sdk.feature.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LangWatch } from "@/client-sdk";
import { DatasetService } from "../dataset.service";
import { DatasetNotFoundError, DatasetApiError } from "../errors";
import { NoOpLogger } from "@/logger";

const createMockApiClient = () => {
  return {
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
    PATCH: vi.fn(),
    DELETE: vi.fn(),
    OPTIONS: vi.fn(),
    HEAD: vi.fn(),
    TRACE: vi.fn(),
    use: vi.fn(),
    eject: vi.fn(),
  } as any;
};

describe("Feature: Dataset TypeScript SDK", () => {
  // ── Facade exposes all methods ──────────────────────────────────

  describe("DatasetsFacade", () => {
    describe("when inspecting langwatch.datasets", () => {
      it("exposes get, list, create, update, delete, createRecords, updateRecord, deleteRecords, and upload methods", () => {
        const langwatch = new LangWatch({
          apiKey: "test-key",
          endpoint: "http://localhost:5560",
        });

        expect(typeof langwatch.datasets.get).toBe("function");
        expect(typeof langwatch.datasets.list).toBe("function");
        expect(typeof langwatch.datasets.create).toBe("function");
        expect(typeof langwatch.datasets.update).toBe("function");
        expect(typeof langwatch.datasets.delete).toBe("function");
        expect(typeof langwatch.datasets.createRecords).toBe("function");
        expect(typeof langwatch.datasets.updateRecord).toBe("function");
        expect(typeof langwatch.datasets.deleteRecords).toBe("function");
        expect(typeof langwatch.datasets.upload).toBe("function");
      });
    });
  });

  // ── List: pagination parameters ─────────────────────────────────

  describe("DatasetService", () => {
    describe("listDatasets()", () => {
      describe("when called with page and limit", () => {
        it("forwards pagination parameters to the API client", async () => {
          const mockClient = createMockApiClient();
          mockClient.GET.mockResolvedValue({
            data: { data: [], total: 0, page: 2, limit: 10 },
            error: null,
            response: { status: 200 },
          });

          const service = new DatasetService({
            langwatchApiClient: mockClient,
            logger: new NoOpLogger(),
            endpoint: "http://localhost:5560",
            apiKey: "test-key",
          });

          await service.listDatasets({ page: 2, limit: 10 });

          expect(mockClient.GET).toHaveBeenCalledWith(
            "/api/dataset",
            expect.objectContaining({
              params: expect.objectContaining({
                query: { page: 2, limit: 10 },
              }),
            }),
          );
        });
      });
    });

    // ── Create: default columnTypes ─────────────────────────────────

    describe("createDataset()", () => {
      describe("when called without columnTypes", () => {
        it("sends columnTypes as an empty array", async () => {
          const mockClient = createMockApiClient();
          mockClient.POST.mockResolvedValue({
            data: {
              id: "d1",
              name: "bare-dataset",
              slug: "bare-dataset",
              columnTypes: [],
            },
            error: null,
            response: { status: 201 },
          });

          const service = new DatasetService({
            langwatchApiClient: mockClient,
            logger: new NoOpLogger(),
            endpoint: "http://localhost:5560",
            apiKey: "test-key",
          });

          await service.createDataset({ name: "bare-dataset" });

          expect(mockClient.POST).toHaveBeenCalledWith(
            "/api/dataset",
            expect.objectContaining({
              body: {
                name: "bare-dataset",
                columnTypes: [],
              },
            }),
          );
        });
      });
    });

    // ── Update: columnTypes ─────────────────────────────────────────

    describe("updateDataset()", () => {
      describe("when called with columnTypes", () => {
        it("includes the new columnTypes in the request body", async () => {
          const mockClient = createMockApiClient();
          mockClient.PATCH.mockResolvedValue({
            data: {
              id: "d1",
              name: "my-data",
              slug: "my-data",
              columnTypes: [{ name: "question", type: "string" }],
            },
            error: null,
            response: { status: 200 },
          });

          const service = new DatasetService({
            langwatchApiClient: mockClient,
            logger: new NoOpLogger(),
            endpoint: "http://localhost:5560",
            apiKey: "test-key",
          });

          await service.updateDataset("my-data", {
            columnTypes: [{ name: "question", type: "string" }],
          });

          expect(mockClient.PATCH).toHaveBeenCalledWith(
            "/api/dataset/{slugOrId}",
            expect.objectContaining({
              body: {
                columnTypes: [{ name: "question", type: "string" }],
              },
            }),
          );
        });
      });
    });

    // ── Error Mapping ───────────────────────────────────────────────

    describe("error mapping", () => {
      let service: DatasetService;
      let mockClient: ReturnType<typeof createMockApiClient>;

      beforeEach(() => {
        mockClient = createMockApiClient();
        service = new DatasetService({
          langwatchApiClient: mockClient,
          logger: new NoOpLogger(),
          endpoint: "http://localhost:5560",
          apiKey: "test-key",
        });
      });

      describe("when the API responds with status 404", () => {
        it("throws a DatasetNotFoundError with the slug in the message", async () => {
          mockClient.GET.mockResolvedValue({
            data: null,
            error: { error: "Not Found", message: "Dataset not found" },
            response: { status: 404 },
          });

          await expect(
            service.getDataset("my-missing-dataset"),
          ).rejects.toThrow(DatasetNotFoundError);

          try {
            await service.getDataset("my-missing-dataset");
          } catch (error) {
            expect(error).toBeInstanceOf(DatasetNotFoundError);
            expect((error as DatasetNotFoundError).message).toContain(
              "my-missing-dataset",
            );
          }
        });
      });

      describe("when the API responds with status 409", () => {
        it("throws a DatasetApiError with status 409 and the conflict message", async () => {
          mockClient.POST.mockResolvedValue({
            data: null,
            error: {
              error: "Conflict",
              message: "A dataset with this slug already exists",
            },
            response: { status: 409 },
          });

          await expect(
            service.createDataset({ name: "duplicate" }),
          ).rejects.toThrow(DatasetApiError);

          await expect(
            service.createDataset({ name: "duplicate" }),
          ).rejects.toMatchObject({
            status: 409,
            message: expect.stringContaining("A dataset with this slug already exists"),
          });
        });
      });

      describe("when the API responds with status 403", () => {
        it("throws a DatasetApiError with status 403", async () => {
          mockClient.GET.mockResolvedValue({
            data: null,
            error: { error: "Forbidden", message: "Access denied" },
            response: { status: 403 },
          });

          await expect(
            service.getDataset("restricted-dataset"),
          ).rejects.toThrow(DatasetApiError);

          await expect(
            service.getDataset("restricted-dataset"),
          ).rejects.toMatchObject({
            status: 403,
          });
        });
      });

      describe("when the API responds with status 500", () => {
        it("throws a DatasetApiError with status 500", async () => {
          mockClient.GET.mockResolvedValue({
            data: null,
            error: { error: "Internal Server Error", message: "Internal error" },
            response: { status: 500 },
          });

          await expect(
            service.getDataset("broken-dataset"),
          ).rejects.toThrow(DatasetApiError);

          await expect(
            service.getDataset("broken-dataset"),
          ).rejects.toMatchObject({
            status: 500,
          });
        });
      });
    });
  });
});
