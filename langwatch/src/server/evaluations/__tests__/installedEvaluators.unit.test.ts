import { describe, expect, it } from "vitest";
import {
  evaluatorUnavailability,
  unavailableEvaluatorMessage,
  PRESIDIO_ENABLE_ENV_VAR,
} from "../installedEvaluators";

describe("evaluator availability on this install", () => {
  describe("when nothing says otherwise", () => {
    it("treats every evaluator as available", () => {
      // Container and Kubernetes installs build the evaluator environment with
      // every extra and never set this variable, so silence must mean present.
      expect(evaluatorUnavailability("presidio/pii_detection", {})).toBeUndefined();
      expect(evaluatorUnavailability("ragas/faithfulness", {})).toBeUndefined();
    });
  });

  describe("when the install skipped the PII model", () => {
    const env = { [PRESIDIO_ENABLE_ENV_VAR]: "false" };

    it("reports the PII detector as not installed", () => {
      const result = evaluatorUnavailability("presidio/pii_detection", env);
      expect(result).toBeDefined();
      expect(result!.reason).toMatch(/not installed/i);
    });

    it("says how to get it, naming the exact switch", () => {
      const result = evaluatorUnavailability("presidio/pii_detection", env)!;
      expect(result.howToEnable).toContain(PRESIDIO_ENABLE_ENV_VAR);
      expect(result.howToEnable).toMatch(/restart/i);
    });

    it("leaves every other evaluator alone", () => {
      expect(evaluatorUnavailability("ragas/faithfulness", env)).toBeUndefined();
      expect(evaluatorUnavailability("lingua/language_detection", env)).toBeUndefined();
    });
  });

  describe("when the install was asked for the PII model", () => {
    it("reports it as available", () => {
      for (const yes of ["true", "1", "yes", "on"]) {
        expect(
          evaluatorUnavailability("presidio/pii_detection", {
            [PRESIDIO_ENABLE_ENV_VAR]: yes,
          }),
        ).toBeUndefined();
      }
    });
  });

  describe("the message shown when one is run anyway", () => {
    it("states what happened and what to do about it", () => {
      const result = evaluatorUnavailability("presidio/pii_detection", {
        [PRESIDIO_ENABLE_ENV_VAR]: "false",
      })!;
      const message = unavailableEvaluatorMessage(result);
      expect(message).toContain(result.reason);
      expect(message).toContain(result.howToEnable);
    });
  });
});
