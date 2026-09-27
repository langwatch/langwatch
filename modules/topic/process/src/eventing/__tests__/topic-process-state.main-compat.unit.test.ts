import { describe, expect, it } from "vitest";

import { topicClusteringProcessStateSchema } from "../topic-clustering.process.ts";

describe("process state stored by the main release", () => {
  it("parses a clustering state stored before runs carried a start time", () => {
    expect(
      topicClusteringProcessStateSchema.parse({
        projectId: "p",
        enabled: true,
        currentRun: { runId: "r", page: 1, updatedAtMs: 2 },
      }),
    ).toEqual({
      projectId: "p",
      enabled: true,
      currentRun: { runId: "r", page: 1, updatedAtMs: 2 },
    });
  });
});
