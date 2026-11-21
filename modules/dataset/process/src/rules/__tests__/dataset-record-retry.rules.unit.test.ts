import { describe, expect, it } from "vitest";

import { datasetRecordReadback } from "../dataset-record-retry.rules.ts";

describe("dataset retry readback IDs", () => {
  it("keeps explicit IDs in request order, including repeated IDs", () => {
    expect(
      datasetRecordReadback({
        projectId: "project-1",
        slugOrId: "dataset-1",
        entries: [
          { id: "b", input: "second" },
          { id: "a", input: "first" },
          { id: "b", input: "second" },
        ],
        readBackExisting: true,
      }),
    ).toEqual({ kind: "existing", ids: ["b", "a", "b"] });
  });

  it("leaves generated-ID batches to the write result", () => {
    expect(
      datasetRecordReadback({
        projectId: "project-1",
        slugOrId: "dataset-1",
        entries: [{ id: "a", input: "first" }, { input: "generated" }],
        readBackExisting: true,
      }),
    ).toEqual({ kind: "written" });
  });

  it("does not request readback unless explicitly enabled", () => {
    expect(
      datasetRecordReadback({
        projectId: "project-1",
        slugOrId: "dataset-1",
        entries: [{ id: "a", input: "first" }],
      }),
    ).toEqual({ kind: "written" });
  });

  it("preserves an explicitly requested empty readback", () => {
    expect(
      datasetRecordReadback({
        projectId: "project-1",
        slugOrId: "dataset-1",
        entries: [],
        readBackExisting: true,
      }),
    ).toEqual({ kind: "existing", ids: [] });
  });
});
