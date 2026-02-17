import { describe, it, expect } from "vitest";
import {
  SuiteDomainError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
} from "../errors";

describe("SuiteDomainError", () => {
  it("is an instance of Error", () => {
    const error = new SuiteDomainError("something went wrong");
    expect(error).toBeInstanceOf(Error);
  });

  it("has name 'SuiteDomainError'", () => {
    const error = new SuiteDomainError("something went wrong");
    expect(error.name).toBe("SuiteDomainError");
  });
});

describe("InvalidScenarioReferencesError", () => {
  describe("given a single invalid scenario ID", () => {
    it("formats the message with the ID", () => {
      const error = new InvalidScenarioReferencesError({
        invalidIds: ["scen_deleted"],
      });
      expect(error.message).toBe("Invalid scenario references: scen_deleted");
    });

    it("exposes invalidIds", () => {
      const error = new InvalidScenarioReferencesError({
        invalidIds: ["scen_deleted"],
      });
      expect(error.invalidIds).toEqual(["scen_deleted"]);
    });
  });

  describe("given multiple invalid scenario IDs", () => {
    it("formats the message with comma-separated IDs", () => {
      const error = new InvalidScenarioReferencesError({
        invalidIds: ["scen_1", "scen_2"],
      });
      expect(error.message).toBe("Invalid scenario references: scen_1, scen_2");
    });
  });

  it("is an instance of SuiteDomainError", () => {
    const error = new InvalidScenarioReferencesError({
      invalidIds: ["scen_1"],
    });
    expect(error).toBeInstanceOf(SuiteDomainError);
  });

  it("has name 'InvalidScenarioReferencesError'", () => {
    const error = new InvalidScenarioReferencesError({
      invalidIds: ["scen_1"],
    });
    expect(error.name).toBe("InvalidScenarioReferencesError");
  });
});

describe("InvalidTargetReferencesError", () => {
  describe("given a single invalid target ID", () => {
    it("formats the message with the ID", () => {
      const error = new InvalidTargetReferencesError({
        invalidIds: ["target_removed"],
      });
      expect(error.message).toBe("Invalid target references: target_removed");
    });

    it("exposes invalidIds", () => {
      const error = new InvalidTargetReferencesError({
        invalidIds: ["target_removed"],
      });
      expect(error.invalidIds).toEqual(["target_removed"]);
    });
  });

  describe("given multiple invalid target IDs", () => {
    it("formats the message with comma-separated IDs", () => {
      const error = new InvalidTargetReferencesError({
        invalidIds: ["t_1", "t_2"],
      });
      expect(error.message).toBe("Invalid target references: t_1, t_2");
    });
  });

  it("is an instance of SuiteDomainError", () => {
    const error = new InvalidTargetReferencesError({
      invalidIds: ["t_1"],
    });
    expect(error).toBeInstanceOf(SuiteDomainError);
  });

  it("has name 'InvalidTargetReferencesError'", () => {
    const error = new InvalidTargetReferencesError({
      invalidIds: ["t_1"],
    });
    expect(error.name).toBe("InvalidTargetReferencesError");
  });
});
