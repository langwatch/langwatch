import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
    checkSimulationRunRatchet,
    currentSimulationRunTypeStrings,
    SIMULATION_RUN_TYPE_STRING_SNAPSHOT,
} from "../ratchet";

describe("the simulation-processing type-string ratchet (ADR-105 decision 10)", () => {
  it("passes against the committed snapshot right now", () => {
    expect(checkSimulationRunRatchet()).toEqual([]);
  });

  it("commits every type string the pipeline currently declares", () => {
    expect(SIMULATION_RUN_TYPE_STRING_SNAPSHOT.simulation_run).toEqual(
      currentSimulationRunTypeStrings().simulation_run,
    );
  });

  it("would fail if a committed string went missing — proving the check actually checks something", () => {
    const violations = checkTypeStringRatchet({
      snapshot: {
        simulation_run: [
          "lw.simulation_run.queued",
          "lw.simulation_run.a_type_that_used_to_exist",
        ],
      },
      current: currentSimulationRunTypeStrings(),
    });
    expect(violations).toEqual([
      {
        declaration: "simulation_run",
        missing: ["lw.simulation_run.a_type_that_used_to_exist"],
      },
    ]);
  });
});
