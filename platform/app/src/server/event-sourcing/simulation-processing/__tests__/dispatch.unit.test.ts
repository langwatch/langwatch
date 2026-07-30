import { parseGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  renderSimulationRunFoldGroupKey,
  simulationRunFoldGroupKey,
} from "../dispatch";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 */
describe("simulationRunFoldGroupKey", () => {
  /** @scenario "The fold's dispatch lane is scoped to one run, never a batch or set" */
  it("scopes the lane to the run alone, with no batch or set in the key", () => {
    const key = simulationRunFoldGroupKey({
      tenantId: "tenant-1",
      scenarioRunId: "run-1",
    });

    expect(key.scope).toEqual({
      kind: "aggregate",
      aggregateType: "simulation_run",
      aggregateId: "run-1",
    });
    expect(key.lane).toEqual({ kind: "fold", name: "simulationRunState" });

    // The function's own signature is the guarantee (there is no parameter
    // to pass a batch or set id through), but round-tripping the rendered
    // key confirms nothing downstream widens it either.
    const rendered = renderSimulationRunFoldGroupKey({
      tenantId: "tenant-1",
      scenarioRunId: "run-1",
    });
    const parsed = parseGroupKey(rendered);
    expect(parsed).toEqual(key);
  });

  it("keys two different runs into two different lanes", () => {
    const a = renderSimulationRunFoldGroupKey({
      tenantId: "t",
      scenarioRunId: "run-a",
    });
    const b = renderSimulationRunFoldGroupKey({
      tenantId: "t",
      scenarioRunId: "run-b",
    });
    expect(a).not.toBe(b);
  });

  it("keeps two runs from different tenants apart even with the same run id", () => {
    const a = renderSimulationRunFoldGroupKey({
      tenantId: "tenant-a",
      scenarioRunId: "run-1",
    });
    const b = renderSimulationRunFoldGroupKey({
      tenantId: "tenant-b",
      scenarioRunId: "run-1",
    });
    expect(a).not.toBe(b);
  });
});
