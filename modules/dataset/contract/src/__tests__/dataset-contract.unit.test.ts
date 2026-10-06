import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  appendStoredObjectToDatasetInputSchema,
  createDatasetFromStoredObjectInputSchema,
  datasetColumnsSchema,
  datasetRecordInputSchema,
  datasetRecordTrpc,
  datasetTrpc,
  upsertDatasetInputSchema,
} from "../index.ts";

describe("Dataset contract", () => {
  it("accepts the legacy column vocabulary", () => {
    expect(
      datasetColumnsSchema.parse([
        { name: "question", type: "string" },
        { name: "score", type: "number" },
        { name: "trace", type: "spans" },
      ]),
    ).toHaveLength(3);
  });

  it("keeps record ids optional at the create boundary", () => {
    expect(datasetRecordInputSchema.parse({ question: "hello" })).toEqual({
      question: "hello",
    });
  });

  it("rejects unknown upsert fields", () => {
    expect(() =>
      upsertDatasetInputSchema.parse({
        projectId: "project_1",
        columnTypes: [],
        unexpected: true,
      }),
    ).toThrow(ZodError);
  });

  describe("given a storedObjectId containing a NUL character", () => {
    const storedObjectId = "so_1\u0000\ufffd";

    /** @scenario "An import naming a stored object id no store can hold is refused as invalid input" */
    it("refuses an append to an existing dataset", () => {
      expect(() =>
        appendStoredObjectToDatasetInputSchema.parse({
          projectId: "project_1",
          slugOrId: "data",
          storedObjectId,
        }),
      ).toThrow(ZodError);
    });

    /** @scenario "An import naming a stored object id no store can hold is refused as invalid input" */
    it("refuses a new dataset built from it", () => {
      expect(() =>
        createDatasetFromStoredObjectInputSchema.parse({
          projectId: "project_1",
          name: "data",
          storedObjectId,
        }),
      ).toThrow(ZodError);
    });
  });

  describe("given a dataset prepared from an uploaded file", () => {
    const prepared = {
      id: "dataset_1",
      projectId: "project_1",
      name: "catalog",
      slug: "catalog",
      columnTypes: [{ name: "image", type: "image" }],
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      archivedAt: null,
      mapping: null,
      useS3: false,
      s3RecordCount: null,
      contentLayout: "s3_jsonl",
      status: "ready",
      statusError: null,
      stagingKey: null,
      uploadFilename: "catalog.jsonl",
      rowCount: 10,
      sizeBytes: 2080n,
      chunkCount: 1,
      chunkOffsets: [{ index: 0, startRow: 0, endRow: 10, byteSize: 2080 }],
    };

    describe("when the browser reads it", () => {
      /** @scenario "A dataset prepared from an uploaded file opens in the browser" */
      it("answers a size the JSON response can carry", () => {
        const answer = datasetTrpc.members.getById.output.parse(prepared);

        expect(JSON.parse(JSON.stringify(answer))).toMatchObject({ sizeBytes: 2080, rowCount: 10 });
      });
    });

    describe("when the browser lists the project's datasets", () => {
      /** @scenario "A dataset prepared from an uploaded file opens in the browser" */
      it("answers a size the JSON response can carry", () => {
        const answer = datasetTrpc.members.getAll.output.parse([{ ...prepared, recordCount: 10 }]);

        expect(JSON.parse(JSON.stringify(answer))).toMatchObject([{ sizeBytes: 2080 }]);
      });
    });

    describe("when the browser reads its rows for an editor or a workbench", () => {
      /** @scenario "A dataset prepared from an uploaded file opens in the browser" */
      it("answers a size the JSON response can carry", () => {
        const all = datasetRecordTrpc.members.getAll.output.parse({
          ...prepared,
          datasetRecords: [],
          truncated: false,
          loadedRows: 0,
          totalRows: 10,
        });
        const head = datasetRecordTrpc.members.getHead.output.parse({
          dataset: { ...prepared, datasetRecords: [] },
          total: 10,
        });

        expect(JSON.parse(JSON.stringify([all, head]))).toMatchObject([
          { sizeBytes: 2080 },
          { dataset: { sizeBytes: 2080 } },
        ]);
      });
    });
  });
});
