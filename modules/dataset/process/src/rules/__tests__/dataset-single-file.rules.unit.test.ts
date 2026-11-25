import { describe, expect, it } from "vitest";

import {
  appendSingleFileRecords,
  isSingleFileDataset,
  parseSingleFileRecords,
  removeSingleFileRecords,
  upsertSingleFileRecord,
} from "../dataset-single-file.rules.ts";

const key = { projectId: "project_a", datasetId: "dataset_a" };
const now = "2026-10-13T00:00:00Z";

describe("isSingleFileDataset", () => {
  it("names only useS3 datasets still on the postgres layout", () => {
    expect(isSingleFileDataset({ useS3: true, contentLayout: "postgres" })).toBe(true);
    expect(isSingleFileDataset({ useS3: true, contentLayout: "s3_jsonl" })).toBe(false);
    expect(isSingleFileDataset({ useS3: false, contentLayout: "postgres" })).toBe(false);
  });
});

describe("parseSingleFileRecords", () => {
  it("keeps every stored field, and reports a file that is not a record array", () => {
    const parsed = parseSingleFileRecords('[{"id":"a","entry":{"q":1},"position":1000}]');
    expect(parsed).toEqual({
      outcome: "parsed",
      records: [{ id: "a", entry: { q: 1 }, position: 1000 }],
    });
    expect(parseSingleFileRecords("not json")).toEqual({ outcome: "unreadable" });
    expect(parseSingleFileRecords('{"id":"a"}')).toEqual({ outcome: "unreadable" });
  });
});

describe("the whole-file changes", () => {
  const stored = [
    { id: "a", entry: { q: "one" }, createdAt: "2025-01-01", position: 1000 },
    { id: "b", entry: { q: "two" } },
  ];

  it("appends in the previous release's shape and positions", () => {
    const records = appendSingleFileRecords({
      ...key,
      records: stored,
      added: [
        { id: "c", entry: { q: "three" } },
        { id: "d", entry: { q: "four" } },
      ],
      now,
    });
    expect(records.slice(2)).toEqual([
      { id: "c", entry: { q: "three" }, ...key, createdAt: now, updatedAt: now, position: 1000 },
      { id: "d", entry: { q: "four" }, ...key, createdAt: now, updatedAt: now, position: 2000 },
    ]);
  });

  it("replaces an entry in place, or appends one the file does not hold", () => {
    const edited = upsertSingleFileRecord({
      ...key,
      records: stored,
      recordId: "a",
      entry: { q: "uno" },
      now,
    });
    expect(edited.created).toBe(false);
    expect(edited.records[0]).toEqual({
      id: "a",
      entry: { q: "uno" },
      createdAt: "2025-01-01",
      position: 1000,
      updatedAt: now,
    });

    const added = upsertSingleFileRecord({
      ...key,
      records: stored,
      recordId: "z",
      entry: { q: "new" },
      now,
    });
    expect(added.created).toBe(true);
    expect(added.records.map((record) => record.id)).toEqual(["a", "b", "z"]);
  });

  it("removes the named ids and counts them", () => {
    expect(removeSingleFileRecords({ records: stored, recordIds: ["b", "x"] })).toEqual({
      records: [stored[0]],
      deleted: 1,
    });
  });
});
