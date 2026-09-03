import { HandledError } from "@langwatch/handled-error";
import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  SuiteNameTakenError,
  SuiteNotFoundError,
} from "../index";
import { describe, expect, it } from "vitest";

describe("Suite errors", () => {
  it("exposes stable handled-error codes and HTTP status", () => {
    const errors = [
      new SuiteNotFoundError("suite_missing"),
      new InvalidScenarioReferencesError({ invalidIds: ["scenario_missing"] }),
      new InvalidTargetReferencesError({ invalidIds: ["target_missing"] }),
      new AllScenariosArchivedError(),
      new AllTargetsArchivedError(),
      new SuiteNameTakenError("Existing suite"),
    ];

    expect(errors.map((error) => error.code)).toEqual([
      "suite_not_found",
      "suite_invalid_scenario_references",
      "suite_invalid_target_references",
      "suite_all_scenarios_archived",
      "suite_all_targets_archived",
      "suite_name_taken",
    ]);
    expect(errors.map((error) => error.httpStatus)).toEqual([404, 422, 422, 422, 422, 409]);
    expect(errors.every(HandledError.isHandled)).toBe(true);
  });

  it("keeps invalid reference ids off the serialized client contract", () => {
    const error = new InvalidScenarioReferencesError({ invalidIds: ["scenario_1"] });
    expect(error.invalidIds).toEqual(["scenario_1"]);
    expect(error.serialize()).toMatchObject({
      code: "suite_invalid_scenario_references",
      meta: {},
    });
  });
});
