// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import {
  nurturingProjectUsagePeerEvents,
  nurturingProjectUsagePeerFold,
} from "../nurturing-project-usage.pipeline.ts";

describe("nurturing's project-usage peer folds", () => {
  /** @scenario "Each owner's fold keeps its own row, and the organization sums every row" */
  it("declares one fold per owner pipeline, each over that owner's events alone", () => {
    const store = MemoryNurturingProjectUsageRepository.create();
    const folds = (["prompt", "evaluator", "scenario", "simulation", "trace"] as const).map(
      (owner) => nurturingProjectUsagePeerFold({ owner, store }).fold,
    );

    expect(folds.map(({ name }) => name)).toEqual([
      "promptUsage",
      "evaluatorUsage",
      "scenarioUsage",
      "simulationUsage",
      "traceUsage",
    ]);
    const types = folds.flatMap(({ eventTypes }) => eventTypes);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toHaveLength(Object.values(nurturingProjectUsagePeerEvents).flat().length);
  });
});
