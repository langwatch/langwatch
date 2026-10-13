import { describe, expect, it } from "vitest";

import { githubBranchRecheckStateSchema } from "../github-branch-recheck.process.ts";

describe("process state stored by the main release", () => {
  it("parses a branch recheck state as main stored it", () => {
    expect(githubBranchRecheckStateSchema.parse({ lastRecheckAt: 1, lastPruneAt: null })).toEqual({
      lastRecheckAt: 1,
      lastPruneAt: null,
    });
  });
});
