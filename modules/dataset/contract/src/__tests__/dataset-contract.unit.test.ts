import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  appendStoredObjectToDatasetInputSchema,
  createDatasetFromStoredObjectInputSchema,
  datasetColumnsSchema,
  datasetRecordInputSchema,
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
});
