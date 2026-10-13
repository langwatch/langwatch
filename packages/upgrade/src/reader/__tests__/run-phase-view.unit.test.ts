import { describe, expect, it } from "vitest";

import { parseRunPhases } from "../run-phase-view.ts";

describe("parseRunPhases()", () => {
  /** @scenario "A run recorded before phases existed reads with no phases" */
  it("reads a report without phases, and no report, as none", () => {
    expect(parseRunPhases({ report: { applied: ["prisma:1"] } })).toEqual([]);
    expect(parseRunPhases({ report: null })).toEqual([]);
    expect(parseRunPhases({ report: { phases: "not a list" } })).toEqual([]);
  });

  /** @scenario "A phase with a name or outcome the reader does not know is passed through raw" */
  it("passes an unknown name and outcome through and drops an entry that is not a phase", () => {
    const phases = parseRunPhases({
      report: {
        phases: [
          { name: "drain", startedAt: "2026-10-06T22:00:00.000Z", outcome: "skipped" },
          "preflight",
          { name: "reconcile" },
        ],
      },
    });
    expect(phases).toEqual([
      {
        name: "drain",
        release: null,
        startedAt: "2026-10-06T22:00:00.000Z",
        finishedAt: null,
        outcome: "skipped",
      },
    ]);
  });
});
