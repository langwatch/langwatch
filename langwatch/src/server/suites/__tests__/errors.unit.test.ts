/**
 * The suite errors are `HandledError`s, and the tRPC router no longer catches
 * them by class — it lets them propagate so the middleware maps the response
 * status straight off `httpStatus`, and the client picks its copy off `code`.
 * So those two fields ARE the contract, and they are what these tests pin. The
 * messages are server copy for a log line; asserting on them pins prose that
 * is free to change.
 */
import { describe, expect, it } from "vitest";
import { HandledError } from "@langwatch/handled-error";
import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  SuiteDomainError,
  SuiteNameTakenError,
} from "../errors";

describe("SuiteDomainError", () => {
  it("is recognised as handled across a module boundary", () => {
    expect(HandledError.isHandled(new SuiteDomainError("no such suite"))).toBe(
      true,
    );
  });

  describe("when raised without an explicit code", () => {
    it("reports the suite as missing", () => {
      const error = new SuiteDomainError("no such suite");
      expect(error.code).toBe("suite_not_found");
      expect(error.httpStatus).toBe(404);
    });
  });

  it("attributes the failure to the caller", () => {
    expect(new SuiteDomainError("no such suite").fault).toBe("customer");
  });
});

describe("InvalidScenarioReferencesError", () => {
  describe("given scenario ids that do not exist", () => {
    it("is unprocessable rather than missing", () => {
      const error = new InvalidScenarioReferencesError({
        invalidIds: ["scen_deleted"],
      });
      expect(error.code).toBe("suite_invalid_scenario_references");
      expect(error.httpStatus).toBe(422);
    });

    it("carries the offending ids where the client reads them", () => {
      const error = new InvalidScenarioReferencesError({
        invalidIds: ["scen_1", "scen_2"],
      });
      expect(error.meta).toEqual({ invalidIds: ["scen_1", "scen_2"] });
      expect(error.invalidIds).toEqual(["scen_1", "scen_2"]);
    });

    it("survives serialisation with its code and ids intact", () => {
      const serialized = new InvalidScenarioReferencesError({
        invalidIds: ["scen_1"],
      }).serialize();
      expect(serialized.code).toBe("suite_invalid_scenario_references");
      expect(serialized.meta).toEqual({ invalidIds: ["scen_1"] });
    });
  });
});

describe("InvalidTargetReferencesError", () => {
  describe("given target ids that do not exist", () => {
    it("is unprocessable rather than missing", () => {
      const error = new InvalidTargetReferencesError({
        invalidIds: ["target_removed"],
      });
      expect(error.code).toBe("suite_invalid_target_references");
      expect(error.httpStatus).toBe(422);
    });

    it("carries the offending ids where the client reads them", () => {
      const error = new InvalidTargetReferencesError({
        invalidIds: ["t_1", "t_2"],
      });
      expect(error.meta).toEqual({ invalidIds: ["t_1", "t_2"] });
      expect(error.invalidIds).toEqual(["t_1", "t_2"]);
    });
  });
});

describe("AllScenariosArchivedError", () => {
  it("is unprocessable, not a missing suite", () => {
    const error = new AllScenariosArchivedError();
    expect(error.code).toBe("suite_all_scenarios_archived");
    expect(error.httpStatus).toBe(422);
  });
});

describe("AllTargetsArchivedError", () => {
  it("is unprocessable, not a missing suite", () => {
    const error = new AllTargetsArchivedError();
    expect(error.code).toBe("suite_all_targets_archived");
    expect(error.httpStatus).toBe(422);
  });
});

describe("SuiteNameTakenError", () => {
  /**
   * A name clash is a conflict, and the middleware derives the response status
   * from `httpStatus` alone. Left at the base class's 404 this would tell a
   * user creating a suite that their suite does not exist.
   */
  it("is a conflict", () => {
    const error = new SuiteNameTakenError();
    expect(error.code).toBe("suite_name_taken");
    expect(error.httpStatus).toBe(409);
  });

  it("attributes the clash to the caller", () => {
    expect(new SuiteNameTakenError().fault).toBe("customer");
  });
});

describe("every suite error", () => {
  /**
   * The base class defaults to `suite_not_found`, so a subclass that forgets
   * its own code silently inherits copy asserting a specific, wrong cause.
   */
  it("declares a code of its own rather than inheriting not-found", () => {
    const errors = [
      new InvalidScenarioReferencesError({ invalidIds: ["x"] }),
      new InvalidTargetReferencesError({ invalidIds: ["x"] }),
      new AllScenariosArchivedError(),
      new AllTargetsArchivedError(),
      new SuiteNameTakenError(),
    ];

    for (const error of errors) {
      expect(error.code).not.toBe("suite_not_found");
    }
    expect(new Set(errors.map((e) => e.code)).size).toBe(errors.length);
  });
});
