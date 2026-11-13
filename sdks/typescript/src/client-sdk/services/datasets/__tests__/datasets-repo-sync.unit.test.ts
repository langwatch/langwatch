/**
 * Keeping a dataset in sync with files held in a repository: create() sends columns and rows in
 * one call, upsertRecords() updates the row whose key column matches instead of appending a copy.
 * Spec: modules/dataset/specs/dataset-repo-sync.feature
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { LangWatch } from "@/client-sdk";

const ENDPOINT = "http://langwatch.test";

const COLUMNS = [
  { name: "case_id", type: "string" },
  { name: "input", type: "string" },
  { name: "expected_output", type: "string" },
];

const DATASET = {
  id: "dataset_qa",
  name: "QA cases",
  slug: "qa-cases",
  columnTypes: COLUMNS,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/acme/datasets/dataset_qa",
};

type Row = { id: string; entry: Record<string, unknown> };

const server = setupServer();

/** The dataset routes a sync uses, over rows held in memory. */
function serveDataset(entries: Record<string, unknown>[]) {
  const state = {
    rows: entries.map((entry, index): Row => ({ id: `rec_${index}`, entry: { ...entry } })),
    requests: [] as string[],
    bodies: [] as unknown[],
  };
  const record = (row: Row) => ({
    id: row.id,
    datasetId: DATASET.id,
    projectId: "project_1",
    entry: row.entry,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const recordsPath = `${ENDPOINT}/api/v1/dataset/${DATASET.slug}/records`;

  server.use(
    http.post(`${ENDPOINT}/api/v1/dataset`, async ({ request }) => {
      const body = (await request.json()) as { name: string };
      state.requests.push("POST /api/v1/dataset");
      state.bodies.push(body);
      return HttpResponse.json({ ...DATASET, name: body.name }, { status: 201 });
    }),
    http.get(recordsPath, ({ request }) => {
      state.requests.push(`GET /api/v1/dataset/${DATASET.slug}/records`);
      const query = new URL(request.url).searchParams;
      const page = Number(query.get("page") ?? 1);
      const limit = Number(query.get("limit") ?? 50);
      const total = state.rows.length;
      return HttpResponse.json({
        data: state.rows.slice((page - 1) * limit, page * limit).map(record),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        dataset: DATASET,
      });
    }),
    http.post(recordsPath, async ({ request }) => {
      const body = (await request.json()) as { entries: Record<string, unknown>[] };
      state.requests.push(`POST /api/v1/dataset/${DATASET.slug}/records`);
      state.bodies.push(body);
      const created = body.entries.map((entry) => {
        const row = { id: `rec_${state.rows.length}`, entry: { ...entry } };
        state.rows.push(row);
        return record(row);
      });
      return HttpResponse.json({ data: created }, { status: 201 });
    }),
    http.patch(`${recordsPath}/:recordId`, async ({ params, request }) => {
      const body = (await request.json()) as { entry: Record<string, unknown> };
      state.requests.push(
        `PATCH /api/v1/dataset/${DATASET.slug}/records/${String(params.recordId)}`,
      );
      const row = state.rows.find((candidate) => candidate.id === params.recordId)!;
      row.entry = { ...body.entry };
      return HttpResponse.json(record(row));
    }),
  );

  return {
    state,
    writes: () => state.requests.filter((request) => !request.startsWith("GET ")),
  };
}

const TWO_ROWS = [
  { case_id: "c-1", input: "hi", expected_output: "hello" },
  { case_id: "c-2", input: "bye", expected_output: "goodbye" },
];

describe("Feature: Keeping a dataset in sync with files held in a repository", () => {
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

  describe("when a dataset is created with columns and rows", () => {
    /** @scenario "The SDKs create a dataset with its columns and rows in one call" */
    it("sends the column types and the entries in one request", async () => {
      const fake = serveDataset([]);

      const created = await langwatch.datasets.create({
        name: "QA cases",
        columnTypes: COLUMNS,
        entries: TWO_ROWS,
      });

      expect(created.slug).toBe("qa-cases");
      expect(fake.state.requests).toEqual(["POST /api/v1/dataset"]);
      expect(fake.state.bodies).toEqual([
        { name: "QA cases", columnTypes: COLUMNS, entries: TWO_ROWS },
      ]);
    });
  });

  describe("when rows are upserted by a key column", () => {
    /** @scenario "Upserting by a key column updates the matching row instead of appending a copy" */
    it("updates the matching row in place through its record id", async () => {
      const fake = serveDataset(TWO_ROWS);

      const result = await langwatch.datasets.upsertRecords(
        "qa-cases",
        [{ case_id: "c-1", input: "hi", expected_output: "hey there" }],
        { key: "case_id" },
      );

      expect(fake.writes()).toEqual(["PATCH /api/v1/dataset/qa-cases/records/rec_0"]);
      expect(result.updated.map((record) => record.id)).toEqual(["rec_0"]);
      expect(result.created).toEqual([]);
      expect(fake.state.rows).toHaveLength(2);
      expect(fake.state.rows[0]!.entry.expected_output).toBe("hey there");
    });

    it("keeps the columns an entry does not send", async () => {
      const fake = serveDataset(TWO_ROWS);

      await langwatch.datasets.upsertRecords(
        "qa-cases",
        [{ case_id: "c-2", expected_output: "see you" }],
        { key: "case_id" },
      );

      expect(fake.state.rows[1]!.entry).toEqual({
        case_id: "c-2",
        input: "bye",
        expected_output: "see you",
      });
    });

    /** @scenario "Upserting by a key column adds the rows whose key is new" */
    it("creates the new keys in one batch request", async () => {
      const fake = serveDataset(TWO_ROWS);

      const result = await langwatch.datasets.upsertRecords(
        "qa-cases",
        [
          { case_id: "c-8", input: "a", expected_output: "b" },
          { case_id: "c-9", input: "c", expected_output: "d" },
        ],
        { key: "case_id" },
      );

      expect(fake.writes()).toEqual(["POST /api/v1/dataset/qa-cases/records"]);
      expect(result.created.map((record) => record.entry.case_id)).toEqual(["c-8", "c-9"]);
      expect(fake.state.rows).toHaveLength(4);
    });

    /** @scenario "Upserting by a key column leaves unchanged rows alone" */
    it("writes nothing for a row it would not change", async () => {
      const fake = serveDataset(TWO_ROWS);

      const result = await langwatch.datasets.upsertRecords("qa-cases", [TWO_ROWS[0]!], {
        key: "case_id",
      });

      expect(fake.writes()).toEqual([]);
      expect(result).toEqual({ created: [], updated: [], unchanged: 1 });
    });

    /** @scenario "Upserting by a key column refuses a key that matches more than one row" */
    it("refuses a key two rows hold, before writing anything", async () => {
      const fake = serveDataset([TWO_ROWS[0]!, { ...TWO_ROWS[0]!, expected_output: "again" }]);

      await expect(
        langwatch.datasets.upsertRecords("qa-cases", [{ case_id: "c-1", input: "x" }], {
          key: "case_id",
        }),
      ).rejects.toMatchObject({ code: "dataset_has_duplicate_key" });
      expect(fake.writes()).toEqual([]);
    });

    /** @scenario "Upserting by a key column refuses two entries with the same key" */
    it("refuses two entries with the same key, before any request", async () => {
      const fake = serveDataset(TWO_ROWS);

      await expect(
        langwatch.datasets.upsertRecords("qa-cases", [{ case_id: "c-5" }, { case_id: "c-5" }], {
          key: "case_id",
        }),
      ).rejects.toMatchObject({ code: "duplicate_upsert_key" });
      expect(fake.state.requests).toEqual([]);
    });

    it("refuses two equal object keys written in another order, as rows are matched", async () => {
      const fake = serveDataset(TWO_ROWS);

      await expect(
        langwatch.datasets.upsertRecords(
          "qa-cases",
          [{ case_id: { a: 1, b: 2 } }, { case_id: { b: 2, a: 1 } }],
          { key: "case_id" },
        ),
      ).rejects.toMatchObject({ code: "duplicate_upsert_key" });
      expect(fake.state.requests).toEqual([]);
    });

    /** @scenario "Upserting by a key column refuses an entry without the key" */
    it("refuses an entry without the key, before any request", async () => {
      const fake = serveDataset(TWO_ROWS);

      await expect(
        langwatch.datasets.upsertRecords("qa-cases", [{ input: "no key" }], { key: "case_id" }),
      ).rejects.toMatchObject({ code: "missing_upsert_key" });
      expect(fake.state.requests).toEqual([]);
    });

    it("refuses a key whose value would not reach the wire, before any request", async () => {
      const fake = serveDataset(TWO_ROWS);

      await expect(
        langwatch.datasets.upsertRecords("qa-cases", [{ case_id: undefined, input: "x" }], {
          key: "case_id",
        }),
      ).rejects.toMatchObject({ code: "missing_upsert_key" });
      expect(fake.state.requests).toEqual([]);
    });

    /** @scenario "Upserting more new keys than one batch carries sends one batch create per 1000 rows" */
    it("creates new keys in batches of a thousand", async () => {
      const fake = serveDataset(TWO_ROWS);
      const entries = Array.from({ length: 2500 }, (_, index) => ({ case_id: `n-${index}` }));

      const result = await langwatch.datasets.upsertRecords("qa-cases", entries, {
        key: "case_id",
      });

      const creates = fake.state.requests.filter((request) => request.startsWith("POST "));
      expect(creates).toHaveLength(3);
      expect(
        fake.state.bodies.map((body) => (body as { entries: unknown[] }).entries.length),
      ).toEqual([1000, 1000, 500]);
      expect(result.created).toHaveLength(2500);
    });

    /** @scenario "Upserting a value that differs only in its JSON type updates the row" */
    it("updates a row whose value changes JSON type", async () => {
      const fake = serveDataset([{ case_id: "c-1", input: false }]);

      const result = await langwatch.datasets.upsertRecords(
        "qa-cases",
        [{ case_id: "c-1", input: 0 }],
        { key: "case_id" },
      );

      expect(fake.writes()).toEqual(["PATCH /api/v1/dataset/qa-cases/records/rec_0"]);
      expect(result.unchanged).toBe(0);
    });

    /** @scenario "Upserting no entries still refuses a dataset that does not exist" */
    it("refuses an unknown dataset even with no entries", async () => {
      serveDataset(TWO_ROWS);
      server.use(
        http.get(`${ENDPOINT}/api/v1/dataset/missing/records`, () =>
          HttpResponse.json({ error: "Not Found" }, { status: 404 }),
        ),
      );

      await expect(
        langwatch.datasets.upsertRecords("missing", [], { key: "case_id" }),
      ).rejects.toMatchObject({ name: "DatasetNotFoundError" });
    });
  });
});
