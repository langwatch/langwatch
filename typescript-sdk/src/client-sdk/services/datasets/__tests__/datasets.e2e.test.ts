/**
 * End-to-end tests for Dataset TypeScript SDK
 *
 * These tests run against a real LangWatch backend.
 * Set LANGWATCH_API_KEY and optionally LANGWATCH_ENDPOINT environment variables.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LangWatch } from "@/client-sdk";
import { DatasetNotFoundError, DatasetApiError } from "../errors";

const SKIP = !process.env.LANGWATCH_API_KEY;

describe.skipIf(SKIP)("Dataset E2E", () => {
  let langwatch: LangWatch;
  const slug = `test-e2e-${Date.now()}`;
  const createdSlugs: string[] = [];

  beforeAll(() => {
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT,
    });
  });

  afterAll(async () => {
    for (const s of createdSlugs) {
      try {
        await langwatch.datasets.delete(s);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ── Dataset CRUD ──────────────────────────────────────────────────

  describe("Dataset CRUD", () => {
    let datasetId: string;
    let datasetSlug: string;

    it("creates a dataset with name and columnTypes", async () => {
      const result = await langwatch.datasets.create({
        name: slug,
        columnTypes: [
          { name: "input", type: "string" },
          { name: "output", type: "string" },
        ],
      });

      createdSlugs.push(result.slug);
      datasetId = result.id;
      datasetSlug = result.slug;

      expect(result.id).toBeDefined();
      expect(result.slug).toBeDefined();
      expect(result.name).toBe(slug);
      expect(result.columnTypes).toEqual([
        { name: "input", type: "string" },
        { name: "output", type: "string" },
      ]);
    });

    it("lists datasets including the created one with recordCount and pagination", async () => {
      const result = await langwatch.datasets.list();

      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBeGreaterThanOrEqual(1);
      expect(result.pagination.total).toBeGreaterThanOrEqual(1);

      const found = result.data.find((d) => d.slug === datasetSlug);
      expect(found).toBeDefined();
      expect(found!.id).toBe(datasetId);
      expect(typeof found!.recordCount).toBe("number");
    });

    it("gets a dataset by slug with metadata and entries array", async () => {
      const dataset = await langwatch.datasets.get(datasetSlug);

      expect(dataset.id).toBe(datasetId);
      expect(dataset.name).toBe(slug);
      expect(dataset.slug).toBe(datasetSlug);
      expect(dataset.columnTypes).toEqual([
        { name: "input", type: "string" },
        { name: "output", type: "string" },
      ]);
      expect(Array.isArray(dataset.entries)).toBe(true);
    });

    it("updates dataset name and verifies new slug", async () => {
      const newName = `${slug}-updated`;
      const result = await langwatch.datasets.update(datasetSlug, {
        name: newName,
      });

      expect(result.name).toBe(newName);
      expect(result.slug).toBeDefined();

      // Track the new slug for cleanup and subsequent tests
      if (result.slug !== datasetSlug) {
        createdSlugs.push(result.slug);
      }
      datasetSlug = result.slug;
    });

    it("deletes dataset and confirms get throws DatasetNotFoundError", async () => {
      await langwatch.datasets.delete(datasetSlug);

      // Remove from cleanup list since already deleted
      const idx = createdSlugs.indexOf(datasetSlug);
      if (idx !== -1) createdSlugs.splice(idx, 1);

      await expect(langwatch.datasets.get(datasetSlug)).rejects.toThrow(
        DatasetNotFoundError
      );
    });
  });

  // ── Record CRUD ───────────────────────────────────────────────────

  describe("Record CRUD", () => {
    let recordSlug: string;
    let recordIds: string[];

    beforeAll(async () => {
      const ds = await langwatch.datasets.create({
        name: `${slug}-records`,
        columnTypes: [
          { name: "input", type: "string" },
          { name: "output", type: "string" },
        ],
      });
      recordSlug = ds.slug;
      createdSlugs.push(recordSlug);
    });

    it("batch creates 3 records and returns IDs", async () => {
      const result = await langwatch.datasets.createRecords(recordSlug, [
        { input: "hello", output: "world" },
        { input: "foo", output: "bar" },
        { input: "ping", output: "pong" },
      ]);

      expect(result.data).toHaveLength(3);
      recordIds = result.data.map((r) => r.id);
      for (const record of result.data) {
        expect(record.id).toBeDefined();
        expect(record.entry).toBeDefined();
      }
    });

    it("lists records with pagination metadata", async () => {
      const result = await langwatch.datasets.listRecords(recordSlug);

      expect(result.data.length).toBeGreaterThanOrEqual(3);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBeGreaterThanOrEqual(3);

      for (const record of result.data) {
        expect(record.id).toBeDefined();
        expect(record.entry).toBeDefined();
      }
    });

    it("updates a record and verifies returned data", async () => {
      const recordId = recordIds[0]!;
      const result = await langwatch.datasets.updateRecord(
        recordSlug,
        recordId,
        { input: "updated-input", output: "updated-output" }
      );

      expect(result.id).toBe(recordId);
      expect(result.entry).toMatchObject({
        input: "updated-input",
        output: "updated-output",
      });
    });

    it("batch deletes records and verifies deletedCount", async () => {
      const idsToDelete = recordIds.slice(1); // delete last 2
      const result = await langwatch.datasets.deleteRecords(
        recordSlug,
        idsToDelete
      );

      expect(result.deletedCount).toBe(2);
    });
  });

  // ── Upload ────────────────────────────────────────────────────────

  describe("Upload", () => {
    let uploadSlug: string;

    beforeAll(async () => {
      const ds = await langwatch.datasets.create({
        name: `${slug}-upload`,
        columnTypes: [
          { name: "input", type: "string" },
          { name: "output", type: "string" },
        ],
      });
      uploadSlug = ds.slug;
      createdSlugs.push(uploadSlug);
    });

    it("uploads CSV file to existing dataset and verifies records added", async () => {
      const file = new File(
        ["input,output\nhello,world\nfoo,bar"],
        "data.csv",
        { type: "text/csv" }
      );

      const result = await langwatch.datasets.upload(uploadSlug, file);

      // Upload to existing dataset returns records array
      expect(
        result.records?.length ?? result.recordsCreated
      ).toBeGreaterThanOrEqual(2);
    });

    it("uploads with replace strategy and verifies old records gone", async () => {
      // First verify there are records from the previous upload
      const before = await langwatch.datasets.listRecords(uploadSlug);
      expect(before.pagination.total).toBeGreaterThanOrEqual(2);

      const file = new File(
        ["input,output\nreplaced,data"],
        "replace.csv",
        { type: "text/csv" }
      );

      await langwatch.datasets.upload(uploadSlug, file, {
        ifExists: "replace",
      });

      // After replace, only the new records exist
      const after = await langwatch.datasets.listRecords(uploadSlug);
      expect(after.pagination.total).toBe(1);
      expect(after.data[0]!.entry).toMatchObject({
        input: "replaced",
        output: "data",
      });
    });

    it("upload creates new dataset when slug does not exist", async () => {
      // Delete the upload dataset first to stay within plan limits
      await langwatch.datasets.delete(uploadSlug);
      const idx = createdSlugs.indexOf(uploadSlug);
      if (idx !== -1) createdSlugs.splice(idx, 1);

      const newSlug = `${slug}-upload-new`;
      const file = new File(
        ["input,output\nnew,dataset"],
        "new.csv",
        { type: "text/csv" }
      );

      const result = await langwatch.datasets.upload(newSlug, file, {
        ifExists: "append",
      });

      // Track the created slug for cleanup (use the one from response if available)
      const createdSlug = result.dataset?.slug ?? newSlug;
      createdSlugs.push(createdSlug);

      expect(result.dataset).toBeDefined();
      expect(result.recordsCreated).toBeGreaterThanOrEqual(1);
      expect(result.datasetId).toBeDefined();
    });
  });

  // ── Error Handling ────────────────────────────────────────────────

  describe("Error handling", () => {
    it("throws DatasetNotFoundError for non-existent dataset", async () => {
      await expect(
        langwatch.datasets.get("does-not-exist-ever-" + Date.now())
      ).rejects.toThrow(DatasetNotFoundError);
    });

    it("throws DatasetApiError for create with empty name", () => {
      expect(() => langwatch.datasets.create({ name: "" })).toThrow(
        DatasetApiError
      );
    });
  });
});
