import {
  topicClusteringRunHistoryEntrySchema,
  topicClusteringStatusSchema,
  topicSchema,
} from "../src";
import { describe, expect, it } from "vitest";

describe("Topic contract", () => {
  it("validates the projected topic shape", () => {
    expect(
      topicSchema.parse({
        id: "topic-1",
        name: "Payments",
        parentId: null,
        automaticallyGenerated: true,
      }),
    ).toEqual({
      id: "topic-1",
      name: "Payments",
      parentId: null,
      automaticallyGenerated: true,
    });
  });

  it("rejects malformed read models", () => {
    expect(() => topicClusteringStatusSchema.parse({})).toThrow();
    expect(() => topicClusteringRunHistoryEntrySchema.parse({})).toThrow();
  });
});
