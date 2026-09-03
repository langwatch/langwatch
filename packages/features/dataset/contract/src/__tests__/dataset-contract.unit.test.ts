import { describe, expect, it } from "vitest";
import {
  datasetColumnsSchema,
  datasetRecordInputSchema,
  upsertDatasetInputSchema,
} from "../index";

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
    ).toThrow();
  });
});
