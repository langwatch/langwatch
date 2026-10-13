import { describe, expect, it } from "vitest";

import {
  evaluationInputKey,
  isEvaluationInputKeyOf,
  legacyEvaluationInputKey,
  retentionClassOf,
} from "../evaluation-input-object.rules.ts";

const sha256 = "a".repeat(64);

describe("retentionClassOf", () => {
  /** @scenario the offload key carries the retention class in force when it was written */
  it.each([
    [49, "r90"],
    [90, "r90"],
    [91, "r180"],
    [365, "r365"],
    [366, "r730"],
    [730, "r730"],
    [731, "r-indefinite"],
    [65534, "r-indefinite"],
    [0, "r-indefinite"],
  ])("rounds %s days up to %s", (retentionDays, expected) => {
    expect(retentionClassOf({ retentionDays })).toBe(expected);
  });
});

describe("evaluation input keys", () => {
  it("puts the kind first, then the class, the project and the content hash", () => {
    expect(evaluationInputKey({ retentionClass: "r365", tenantId: "project-1", sha256 })).toBe(
      `evaluation-inputs/r365/project-1/${sha256}.json`,
    );
  });

  it("recognises only the keys one project can own", () => {
    const own = evaluationInputKey({ retentionClass: "r90", tenantId: "project-1", sha256 });
    const other = evaluationInputKey({ retentionClass: "r90", tenantId: "project-2", sha256 });
    const legacy = legacyEvaluationInputKey({ tenantId: "project-1", sha256 });

    expect(isEvaluationInputKeyOf({ tenantId: "project-1", key: own })).toBe(true);
    expect(isEvaluationInputKeyOf({ tenantId: "project-1", key: legacy })).toBe(true);
    expect(isEvaluationInputKeyOf({ tenantId: "project-1", key: other })).toBe(false);
    expect(isEvaluationInputKeyOf({ tenantId: "project-1", key: "project-1/../secrets" })).toBe(
      false,
    );
    expect(isEvaluationInputKeyOf({ tenantId: "project.1", key: own })).toBe(false);
  });
});
