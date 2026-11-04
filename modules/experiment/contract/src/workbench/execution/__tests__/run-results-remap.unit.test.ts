/**
 * A run over a dataset version moves its cells onto the board rows with the same ids.
 * @see specs/experiments-v3/dataset-version-pin.feature
 */
import { describe, expect, it } from "vitest";

import { emptyRunResultsDraft, invertRowIndices, remapRunResultsDraft } from "../run-results.ts";

describe("remapRunResultsDraft", () => {
  describe("given a draft over three run rows and a board that lost the middle one", () => {
    const draft = {
      ...emptyRunResultsDraft(),
      runId: "run_1",
      startedCells: new Set(["0:t", "1:t", "2:t"]),
      targetOutputs: { t: ["a", "b", "c"] },
      targetMetadata: { t: [{ cost: 1 }, { cost: 2 }, { cost: 3 }] },
      evaluatorResults: { t: { judge: ["pass-a", "pass-b", "pass-c"] } },
      errors: { t: [null, "failed", null] },
    };

    /** @scenario "A pinned run skips rows the board no longer has" */
    it("moves every cell to its board row and leaves the lost row out", () => {
      const moved = remapRunResultsDraft({ draft, boardRowIndices: [2, null, 0] });

      expect(moved.runId).toBe("run_1");
      expect([...moved.startedCells].toSorted()).toEqual(["0:t", "2:t"]);
      expect(moved.targetOutputs.t).toEqual(["c", undefined, "a"]);
      expect(moved.targetMetadata.t).toEqual([{ cost: 3 }, undefined, { cost: 1 }]);
      expect(moved.evaluatorResults.t?.judge).toEqual(["pass-c", undefined, "pass-a"]);
      expect(moved.errors.t).toEqual([null, undefined, null]);
    });
  });
});

describe("invertRowIndices", () => {
  it("answers, for each board row, the run row that moved there", () => {
    expect(invertRowIndices([2, null, 0])).toEqual([2, null, 0]);
    expect(invertRowIndices([1, null])).toEqual([null, 0]);
  });
});
