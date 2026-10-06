/**
 * datasets.get() reads a dataset page by page. A fake server behind msw serves the records
 * endpoint, the datasets list and the single-response endpoint, refusing the last one above
 * its size cap the way the platform does.
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { LangWatch } from "@/client-sdk";

import { DatasetApiError, DatasetNotFoundError } from "../errors";

const ENDPOINT = "http://langwatch.test";
const MB = 1024 * 1024;
const SINGLE_RESPONSE_CAP_BYTES = 25 * MB;

const DATASET = {
  id: "dataset_images",
  name: "Product images",
  slug: "product-images",
  columnTypes: [{ name: "image", type: "image" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/acme/datasets/dataset_images",
};

type Page = { page: number; limit: number };

type FakeDataset = {
  rowCount: number;
  rowBytes: (index: number) => number;
  pageCapBytes?: number;
  hasRecordsEndpoint?: boolean;
  rowCountAfterFirstPage?: number;
  sendsDatasetWithPages?: boolean;
  suggestsLimit?: boolean;
  refusesSingleRows?: boolean;
  listsDataset?: boolean;
};

const server = setupServer();

/** The three dataset read routes, with rows generated only when a page asks for them. */
function serveDataset(dataset: FakeDataset) {
  const state = {
    rowCount: dataset.rowCount,
    requests: [] as string[],
    recordPages: [] as Page[],
    refusedPages: [] as Page[],
  };
  const row = (index: number) => ({
    id: `rec_${index}`,
    datasetId: DATASET.id,
    projectId: "project_1",
    entry: { index, image: "x".repeat(dataset.rowBytes(index)) },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const bytesOf = (start: number, end: number) => {
    let bytes = 0;
    for (let index = start; index < end; index++) bytes += dataset.rowBytes(index);
    return bytes;
  };
  const known = (slugOrId: unknown) => slugOrId === DATASET.slug || slugOrId === DATASET.id;
  const notFound = () => HttpResponse.json({ error: "Not Found" }, { status: 404 });

  server.use(
    http.get(`${ENDPOINT}/api/v1/dataset`, () => {
      state.requests.push("GET /api/v1/dataset");
      return HttpResponse.json({
        data: dataset.listsDataset === false ? [] : [{ ...DATASET, recordCount: state.rowCount }],
        pagination: { page: 1, limit: 1000, total: 1, totalPages: 1 },
      });
    }),
    http.get(`${ENDPOINT}/api/v1/dataset/:slugOrId/records`, ({ params, request }) => {
      state.requests.push(`GET /api/v1/dataset/${String(params.slugOrId)}/records`);
      if (dataset.hasRecordsEndpoint === false || !known(params.slugOrId)) return notFound();

      const query = new URL(request.url).searchParams;
      const page = Number(query.get("page") ?? 1);
      const limit = Number(query.get("limit") ?? 50);
      const start = (page - 1) * limit;
      const end = Math.min(start + limit, state.rowCount);

      const cap = dataset.pageCapBytes;
      const refusable = end - start > 1 || dataset.refusesSingleRows === true;
      if (cap !== undefined && bytesOf(start, end) > cap && refusable) {
        state.refusedPages.push({ page, limit });
        // The largest power of two of rows that fits, as the platform's divisor rule gives
        // for the page sizes the SDK asks for.
        let suggestedLimit = limit;
        while (suggestedLimit > 1 && bytesOf(start, start + suggestedLimit) > cap) {
          suggestedLimit /= 2;
        }
        const hints =
          dataset.suggestsLimit === false
            ? {}
            : { suggestedLimit, suggestedPage: start / suggestedLimit + 1 };
        return HttpResponse.json(
          {
            code: "dataset_page_too_large",
            message: "This page of records is too large for one response.",
            meta: { page, limit, ...hints },
          },
          { status: 413 },
        );
      }

      state.recordPages.push({ page, limit });
      const total = state.rowCount;
      const data = [];
      for (let index = start; index < end; index++) data.push(row(index));
      if (dataset.rowCountAfterFirstPage !== undefined) {
        state.rowCount = dataset.rowCountAfterFirstPage;
      }
      return HttpResponse.json({
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        ...(dataset.sendsDatasetWithPages === false ? {} : { dataset: DATASET }),
      });
    }),
    http.get(`${ENDPOINT}/api/v1/dataset/:slugOrId`, ({ params }) => {
      state.requests.push(`GET /api/v1/dataset/${String(params.slugOrId)}`);
      if (!known(params.slugOrId)) return notFound();
      if (bytesOf(0, state.rowCount) > SINGLE_RESPONSE_CAP_BYTES) {
        return HttpResponse.json(
          {
            code: "dataset_too_large_to_read_inline",
            message: "This dataset is larger than the 27.7 MB one response carries.",
          },
          { status: 400 },
        );
      }
      const data = [];
      for (let index = 0; index < state.rowCount; index++) data.push(row(index));
      return HttpResponse.json({ ...DATASET, data });
    }),
  );

  return { state, row };
}

const indexesOf = (dataset: { entries: { entry: Record<string, unknown> }[] }) =>
  dataset.entries.map((entry) => entry.entry.index);

const range = (length: number) => Array.from({ length }, (_, index) => index);

describe("Feature: Dataset TypeScript SDK paged read", () => {
  let langwatch: LangWatch;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
    langwatch = new LangWatch({ apiKey: "test-api-key", endpoint: ENDPOINT });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe("given a dataset larger than the single response limit", () => {
    describe("when the dataset is fetched", () => {
      /** @scenario "datasets.get reads a dataset larger than the single response limit page by page" */
      it("returns every row in order without the single request", async () => {
        const { state } = serveDataset({ rowCount: 40, rowBytes: () => MB });

        const dataset = await langwatch.datasets.get("product-images");

        expect(dataset.entries.map((entry) => entry.id)).toEqual(
          range(40).map((index) => `rec_${index}`),
        );
        expect(indexesOf(dataset)).toEqual(range(40));
        expect((dataset.entries[39]!.entry.image as string).length).toBe(MB);
        expect(state.requests).not.toContain("GET /api/v1/dataset/product-images");
        expect(state.requests).not.toContain("GET /api/v1/dataset");
        // The second page is smaller: the first one came back above the byte target.
        expect(state.recordPages).toEqual([
          { page: 1, limit: 16 },
          { page: 3, limit: 8 },
          { page: 4, limit: 8 },
          { page: 5, limit: 8 },
        ]);
      });
    });
  });

  describe("given a dataset read page by page", () => {
    describe("when the dataset is fetched", () => {
      /** @scenario "datasets.get keeps the shape of the single response" */
      it("returns the same metadata and entries as the single request", async () => {
        const { row } = serveDataset({ rowCount: 3, rowBytes: () => 10 });

        const dataset = await langwatch.datasets.get("product-images");

        expect(dataset).toEqual({
          id: DATASET.id,
          name: DATASET.name,
          slug: DATASET.slug,
          columnTypes: DATASET.columnTypes,
          createdAt: DATASET.createdAt,
          updatedAt: DATASET.updatedAt,
          entries: [row(0), row(1), row(2)],
        });
      });
    });

    describe("when the dataset is fetched by its id", () => {
      /** @scenario "datasets.get by id reads the same dataset page by page" */
      it("returns the dataset the id names", async () => {
        serveDataset({ rowCount: 20, rowBytes: () => 10 });

        const dataset = await langwatch.datasets.get("dataset_images");

        expect(dataset.slug).toBe("product-images");
        expect(indexesOf(dataset)).toEqual(range(20));
      });
    });
  });

  describe("given a server that refuses pages above its page size limit", () => {
    describe("when a refusal suggests a page size", () => {
      /** @scenario "datasets.get follows the page size a refusal suggests" */
      it("asks again with the suggested page size", async () => {
        const { state } = serveDataset({
          rowCount: 40,
          rowBytes: () => MB,
          pageCapBytes: 5 * MB,
        });

        const dataset = await langwatch.datasets.get("product-images");

        expect(indexesOf(dataset)).toEqual(range(40));
        expect(state.refusedPages[0]).toEqual({ page: 1, limit: 16 });
        expect(state.recordPages).toEqual(
          range(10).map((index) => ({ page: index + 1, limit: 4 })),
        );
        // Later attempts to grow the page are spaced further and further apart.
        expect(state.refusedPages.slice(1).map((page) => page.limit)).toEqual([8, 8, 8]);
      });
    });

    describe("when a refusal suggests no page size", () => {
      /** @scenario "datasets.get asks for fewer rows when the server refuses a page as too large" */
      it("halves the page size and reads on from the same row", async () => {
        const { state } = serveDataset({
          rowCount: 40,
          rowBytes: () => MB,
          pageCapBytes: 5 * MB,
          suggestsLimit: false,
        });

        const dataset = await langwatch.datasets.get("product-images");

        expect(indexesOf(dataset)).toEqual(range(40));
        expect(state.refusedPages.slice(0, 2)).toEqual([
          { page: 1, limit: 16 },
          { page: 1, limit: 8 },
        ]);
        expect(state.recordPages).toEqual(
          range(10).map((index) => ({ page: index + 1, limit: 4 })),
        );
      });
    });

    describe("when one row is as large as a whole page may be", () => {
      /** @scenario "datasets.get reads one oversized row alone and returns to larger pages" */
      it("reads that row alone, then grows the page again", async () => {
        const { state } = serveDataset({
          rowCount: 600,
          rowBytes: (index) => (index === 0 ? 20 * MB : 1024),
          pageCapBytes: 20 * MB,
        });

        const dataset = await langwatch.datasets.get("product-images");

        expect(indexesOf(dataset)).toEqual(range(600));
        expect(state.recordPages[0]).toEqual({ page: 1, limit: 1 });
        expect(Math.max(...state.recordPages.map((page) => page.limit))).toBe(512);
      });
    });

    describe("when a single row is too large for any page", () => {
      /** @scenario "datasets.get throws the refusal when a single row is too large to read" */
      it("throws a DatasetApiError with status 413", async () => {
        const { state } = serveDataset({
          rowCount: 2,
          rowBytes: () => 2 * MB,
          pageCapBytes: MB,
          refusesSingleRows: true,
        });

        const error = await langwatch.datasets.get("product-images").catch((e: unknown) => e);

        expect(error).toBeInstanceOf(DatasetApiError);
        expect((error as DatasetApiError).status).toBe(413);
        expect(state.refusedPages.at(-1)).toEqual({ page: 1, limit: 1 });
      });
    });
  });

  describe("given a server that sends no dataset with its pages", () => {
    describe("when the dataset is listed", () => {
      /** @scenario "datasets.get finds the metadata in the datasets list on a server that sends none with its pages" */
      it("reads the metadata from the datasets list", async () => {
        const { state } = serveDataset({
          rowCount: 40,
          rowBytes: () => MB,
          sendsDatasetWithPages: false,
        });

        const dataset = await langwatch.datasets.get("product-images");

        expect(dataset.id).toBe("dataset_images");
        expect(dataset.slug).toBe("product-images");
        expect(dataset.entries).toHaveLength(40);
        expect(state.requests.at(-1)).toBe("GET /api/v1/dataset");
        expect(state.requests).not.toContain("GET /api/v1/dataset/product-images");
      });
    });

    describe("when only the single request can name the dataset and it is too large", () => {
      /** @scenario "datasets.get throws the server's refusal when only the single request can name the dataset" */
      it("throws the refusal instead of returning a partial result", async () => {
        serveDataset({
          rowCount: 40,
          rowBytes: () => MB,
          sendsDatasetWithPages: false,
          listsDataset: false,
        });

        const error = await langwatch.datasets.get("product-images").catch((e: unknown) => e);

        expect(error).toBeInstanceOf(DatasetApiError);
        expect((error as DatasetApiError).status).toBe(400);
        expect((error as DatasetApiError).originalError).toMatchObject({
          code: "dataset_too_large_to_read_inline",
        });
      });
    });
  });

  describe("given a server without the records endpoint", () => {
    describe("when the dataset is fetched", () => {
      /** @scenario "datasets.get falls back to the single request on a server without the records endpoint" */
      it("reads the dataset with the single request", async () => {
        const { state } = serveDataset({
          rowCount: 5,
          rowBytes: () => 10,
          hasRecordsEndpoint: false,
        });

        const dataset = await langwatch.datasets.get("product-images");

        expect(indexesOf(dataset)).toEqual(range(5));
        expect(dataset.slug).toBe("product-images");
        expect(state.requests).toEqual([
          "GET /api/v1/dataset/product-images/records",
          "GET /api/v1/dataset/product-images",
        ]);
      });
    });

    describe("when the dataset does not exist", () => {
      /** @scenario "datasets.get throws not found when neither request finds the dataset" */
      it("throws a DatasetNotFoundError", async () => {
        serveDataset({ rowCount: 0, rowBytes: () => 0 });

        await expect(langwatch.datasets.get("does-not-exist")).rejects.toThrow(
          DatasetNotFoundError,
        );
      });
    });
  });

  describe("given rows removed while the dataset is read", () => {
    describe("when a page comes back short", () => {
      /** @scenario "datasets.get stops when rows are removed while it is reading" */
      it("ends the read at that page", async () => {
        const { state } = serveDataset({
          rowCount: 600,
          rowBytes: () => 10,
          rowCountAfterFirstPage: 300,
        });

        const dataset = await langwatch.datasets.get("product-images");

        expect(indexesOf(dataset)).toEqual(range(300));
        expect(state.recordPages.at(-1)).toEqual({ page: 2, limit: 256 });
      });
    });
  });
});
