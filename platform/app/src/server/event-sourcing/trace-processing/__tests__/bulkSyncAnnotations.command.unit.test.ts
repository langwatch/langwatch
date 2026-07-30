import { describe, expect, it } from "vitest";
import { bulkSyncAnnotations } from "../bulkSyncAnnotations.command";
import { TRACE_ID } from "./fixtures";

describe("the bulkSyncAnnotations command", () => {
  it("emits exactly the annotationsBulkSynced event", async () => {
    const input = { traceId: TRACE_ID, annotationIds: ["ann-1", "ann-2"], actedAt: 10 };
    expect(await bulkSyncAnnotations(input)).toEqual([
      { type: "annotationsBulkSynced", data: input },
    ]);
  });
});
