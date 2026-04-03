import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DatasetsCliService,
  DatasetsCliServiceError,
} from "../datasets-cli.service";

describe("DatasetsCliService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LANGWATCH_API_KEY: "test-api-key",
      LANGWATCH_ENDPOINT: "https://test.langwatch.ai",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("when listing datasets", () => {
    it("calls GET /api/dataset with pagination params", async () => {
      const mockResponse = {
        data: [{ id: "ds_1", name: "Test", slug: "test", recordCount: 5 }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const service = new DatasetsCliService();
      const result = await service.list({ page: 1, limit: 50 });

      expect(fetch).toHaveBeenCalledWith(
        "https://test.langwatch.ai/api/dataset?page=1&limit=50",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-auth-token": "test-api-key",
          }),
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.slug).toBe("test");
    });
  });

  describe("when creating a dataset", () => {
    it("calls POST /api/dataset with name and columns", async () => {
      const mockResponse = {
        id: "ds_new",
        name: "New",
        slug: "new",
        columnTypes: [{ name: "input", type: "string" }],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 201 }),
      );

      const service = new DatasetsCliService();
      const result = await service.create({
        name: "New",
        columnTypes: [{ name: "input", type: "string" }],
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://test.langwatch.ai/api/dataset",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "New",
            columnTypes: [{ name: "input", type: "string" }],
          }),
        }),
      );
      expect(result.slug).toBe("new");
    });
  });

  describe("when API returns an error", () => {
    it("throws DatasetsCliServiceError with status", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
      );

      const service = new DatasetsCliService();

      try {
        await service.get("nonexistent");
        expect.fail("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DatasetsCliServiceError);
        expect((error as DatasetsCliServiceError).status).toBe(404);
        expect((error as DatasetsCliServiceError).message).toBe("Not found");
      }
    });
  });

  describe("when deleting a dataset", () => {
    it("calls DELETE /api/dataset/:slug", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      const service = new DatasetsCliService();
      const result = await service.delete("my-dataset");

      expect(fetch).toHaveBeenCalledWith(
        "https://test.langwatch.ai/api/dataset/my-dataset",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("when fetching all records with pagination", () => {
    it("fetches multiple pages and concatenates results", async () => {
      const page1 = {
        data: [{ id: "r1", entry: { input: "a" } }],
        pagination: { page: 1, limit: 1000, total: 2, totalPages: 2 },
      };
      const page2 = {
        data: [{ id: "r2", entry: { input: "b" } }],
        pagination: { page: 2, limit: 1000, total: 2, totalPages: 2 },
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify(page1), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(page2), { status: 200 }),
        );

      const service = new DatasetsCliService();
      const records = await service.getAllRecords("my-dataset");

      expect(records).toHaveLength(2);
      expect(records[0]!.id).toBe("r1");
      expect(records[1]!.id).toBe("r2");
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("when endpoint has trailing slash", () => {
    it("strips it to avoid double slashes", async () => {
      process.env.LANGWATCH_ENDPOINT = "https://test.langwatch.ai/";

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } }), { status: 200 }),
      );

      const service = new DatasetsCliService();
      await service.list();

      expect(fetch).toHaveBeenCalledWith(
        "https://test.langwatch.ai/api/dataset?page=1&limit=50",
        expect.anything(),
      );
    });
  });
});
