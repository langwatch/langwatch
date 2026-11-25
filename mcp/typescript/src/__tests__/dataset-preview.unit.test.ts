import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initConfig } from "../config.ts";
import { handleGetDataset } from "../tools/get-dataset.ts";

const ENDPOINT = "https://test.langwatch.ai";
const MB = 1024 * 1024;

const DATASET = {
  id: "dataset_images",
  name: "Product images",
  slug: "product-images",
  columnTypes: [{ name: "image", type: "image" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/acme/datasets/dataset_images",
};

type FakeDataset = {
  rowCount: number;
  rowBytes: (index: number) => number;
  pageCapBytes?: number;
  sendsDatasetWithPages?: boolean;
};

/** Serves the records page and the single-response read of one dataset through `fetch`. */
function serveDataset(dataset: FakeDataset) {
  const requests: string[] = [];
  const row = (index: number) => ({
    id: `rec_${index}`,
    entry: { index, image: "x".repeat(dataset.rowBytes(index)) },
  });
  const rows = (start: number, end: number) =>
    Array.from({ length: Math.max(0, end - start) }, (_, offset) => row(start + offset));
  const bytesOf = (start: number, end: number) =>
    rows(start, end).reduce((sum, _, offset) => sum + dataset.rowBytes(start + offset), 0);

  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    requests.push(`${url.pathname}${url.search}`);

    if (url.pathname === "/api/v1/dataset/product-images/records") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const start = (page - 1) * limit;
      const end = Math.min(start + limit, dataset.rowCount);
      const cap = dataset.pageCapBytes;
      if (cap !== undefined && end - start > 1 && bytesOf(start, end) > cap) {
        return Response.json(
          {
            code: "dataset_page_too_large",
            message: "This page of records is too large for one response.",
            meta: { page, limit, suggestedLimit: 10, suggestedPage: 1 },
          },
          { status: 413 },
        );
      }
      return Response.json({
        data: rows(start, end),
        pagination: {
          page,
          limit,
          total: dataset.rowCount,
          totalPages: Math.ceil(dataset.rowCount / limit),
        },
        ...(dataset.sendsDatasetWithPages === false ? {} : { dataset: DATASET }),
      });
    }

    if (url.pathname === "/api/v1/dataset/product-images") {
      return Response.json({ ...DATASET, data: rows(0, dataset.rowCount) });
    }
    return Response.json({ message: "Dataset not found" }, { status: 404 });
  });

  return { requests };
}

describe("platform_get_dataset preview", () => {
  beforeEach(() => {
    initConfig({ apiKey: "test-key", endpoint: ENDPOINT });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("given a dataset with more records than a preview holds", () => {
    describe("when the dataset is fetched as json", () => {
      /** @scenario "Get dataset previews a dataset of any size and says how many records it left out" */
      it("returns the first records and counts the ones left out", async () => {
        const { requests } = serveDataset({ rowCount: 5000, rowBytes: () => 100 });

        const result = JSON.parse(
          await handleGetDataset({ slugOrId: "product-images", format: "json" }),
        );

        expect(result).toMatchObject({
          id: "dataset_images",
          name: "Product images",
          slug: "product-images",
          columnTypes: DATASET.columnTypes,
          totalRecords: 5000,
          omittedRecords: 4900,
        });
        expect(result.data.map((record: { id: string }) => record.id)).toEqual(
          Array.from({ length: 100 }, (_, index) => `rec_${index}`),
        );
        expect(result.note).toContain("Showing 100 of 5000 records");
        expect(result.note).toContain("platform_list_dataset_records");
        expect(requests).toEqual(["/api/v1/dataset/product-images/records?page=1&limit=100"]);
      });
    });

    describe("when the dataset is fetched as a digest", () => {
      /** @scenario "Get dataset digest names the records a preview left out" */
      it("ends with a note naming the records left out", async () => {
        serveDataset({ rowCount: 5000, rowBytes: () => 100 });

        const result = await handleGetDataset({ slugOrId: "product-images" });

        expect(result).toContain("## Records (100 shown)");
        expect(result).toContain("Showing 100 of 5000 records: 4900 are left out.");
      });
    });
  });

  describe("given a dataset whose records are large", () => {
    describe("when the server refuses the first page as too large", () => {
      /** @scenario "Get dataset asks for a smaller preview page when the server refuses one as too large" */
      it("asks again with the suggested page size and cuts the preview by bytes", async () => {
        const { requests } = serveDataset({
          rowCount: 40,
          rowBytes: () => MB / 4,
          pageCapBytes: 5 * MB,
        });

        const result = JSON.parse(
          await handleGetDataset({ slugOrId: "product-images", format: "json" }),
        );

        expect(requests).toEqual([
          "/api/v1/dataset/product-images/records?page=1&limit=100",
          "/api/v1/dataset/product-images/records?page=1&limit=10",
        ]);
        expect(result.data).toHaveLength(3);
        expect(result.omittedRecords).toBe(37);
        expect(result.note).toContain("Showing 3 of 40 records");
      });
    });
  });

  describe("given a dataset that fits a preview", () => {
    describe("when the dataset is fetched", () => {
      /** @scenario "Get dataset shows every record of a small dataset without a note" */
      it("returns every record and no note", async () => {
        serveDataset({ rowCount: 3, rowBytes: () => 10 });

        const result = JSON.parse(
          await handleGetDataset({ slugOrId: "product-images", format: "json" }),
        );

        expect(result.data).toHaveLength(3);
        expect(result.omittedRecords).toBe(0);
        expect(result.note).toBeUndefined();
      });
    });
  });

  describe("given a server that sends no dataset with its records pages", () => {
    describe("when the dataset is fetched", () => {
      /** @scenario "Get dataset reads the whole dataset in one response on a server without paged metadata" */
      it("falls back to the single response", async () => {
        const { requests } = serveDataset({
          rowCount: 3,
          rowBytes: () => 10,
          sendsDatasetWithPages: false,
        });

        const result = JSON.parse(
          await handleGetDataset({ slugOrId: "product-images", format: "json" }),
        );

        expect(result.data).toHaveLength(3);
        expect(requests.at(-1)).toBe("/api/v1/dataset/product-images");
      });
    });
  });
});
