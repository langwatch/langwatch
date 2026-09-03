import { describe, expect, it } from "vitest";
import { datasetNormalizePayloadSchema } from "../dataset-normalization";

describe("datasetNormalizePayloadSchema", () => {
  it("rejects malformed durable worker payloads before Dataset normalization", () => {
    const result = datasetNormalizePayloadSchema.safeParse({
      id: "upload-1",
      tenantId: "project-1",
      projectId: "project-1",
      datasetId: "dataset-1",
      stagingKey: "staging/upload-1.csv",
    });

    expect(result.success).toBe(false);
  });
});
