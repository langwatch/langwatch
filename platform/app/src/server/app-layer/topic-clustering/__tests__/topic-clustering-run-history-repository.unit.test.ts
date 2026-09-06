import { describe, expect, it } from "vitest";

import { parseRunHistoryRuns } from "../repositories/topic-clustering-run-history-projection.prisma.repository";

const validRun = {
  runId: "20260720T093000",
  trigger: "scheduled",
  startedAt: 1_000,
  finishedAt: 2_000,
  outcome: "completed",
  mode: "batch",
  skippedReason: null,
  errorCode: null,
  isErrorUserActionable: false,
  tracesProcessed: 100,
  topicsCount: 8,
  subtopicsCount: 24,
  pages: 1,
};

describe("parseRunHistoryRuns", () => {
  describe("when the stored JSON matches the entry shape", () => {
    it("returns the entries", () => {
      expect(parseRunHistoryRuns([validRun])).toEqual([validRun]);
    });
  });

  describe("when the stored JSON is corrupted", () => {
    it("degrades to an empty history instead of throwing", () => {
      expect(parseRunHistoryRuns("not an array")).toEqual([]);
      expect(parseRunHistoryRuns([{ runId: 42 }])).toEqual([]);
      expect(parseRunHistoryRuns(null)).toEqual([]);
    });
  });
});
