import { describe, expect, it } from "vitest";
import {
  evaluatorUnavailability,
  LEGACY_EVALUATORS_ENABLE_ENV_VAR,
  LINGUA_ENABLE_ENV_VAR,
  PRESIDIO_ENABLE_ENV_VAR,
  unavailableEvaluatorMessage,
} from "../installedEvaluators";

describe("evaluator availability on this install", () => {
  describe("when nothing says otherwise", () => {
    it("treats every evaluator as available", () => {
      // Container and Kubernetes installs build the evaluator environment with
      // every extra and never set these variables, so silence must mean present.
      expect(
        evaluatorUnavailability({
          evaluatorType: "presidio/pii_detection",
          env: {},
        }),
      ).toBeUndefined();
      expect(
        evaluatorUnavailability({
          evaluatorType: "lingua/language_detection",
          env: {},
        }),
      ).toBeUndefined();
      expect(
        evaluatorUnavailability({
          evaluatorType: "legacy/ragas_faithfulness",
          env: {},
        }),
      ).toBeUndefined();
      expect(
        evaluatorUnavailability({
          evaluatorType: "ragas/faithfulness",
          env: {},
        }),
      ).toBeUndefined();
    });
  });

  describe("when the install skipped the PII model", () => {
    const env = { [PRESIDIO_ENABLE_ENV_VAR]: "false" };

    it("reports the PII detector as not installed", () => {
      const result = evaluatorUnavailability({
        evaluatorType: "presidio/pii_detection",
        env,
      });
      expect(result).toBeDefined();
      expect(result!.reason).toMatch(/not installed/i);
    });

    it("says how to get it, naming the exact switch", () => {
      const result = evaluatorUnavailability({
        evaluatorType: "presidio/pii_detection",
        env,
      })!;
      expect(result.howToEnable).toContain(PRESIDIO_ENABLE_ENV_VAR);
      expect(result.howToEnable).toMatch(/restart/i);
    });

    it("leaves every other evaluator alone", () => {
      expect(
        evaluatorUnavailability({ evaluatorType: "ragas/faithfulness", env }),
      ).toBeUndefined();
      expect(
        evaluatorUnavailability({
          evaluatorType: "lingua/language_detection",
          env,
        }),
      ).toBeUndefined();
    });
  });

  describe("when the install was asked for the PII model", () => {
    it("reports it as available", () => {
      for (const yes of ["true", "1", "yes", "on"]) {
        expect(
          evaluatorUnavailability({
            evaluatorType: "presidio/pii_detection",
            env: { [PRESIDIO_ENABLE_ENV_VAR]: yes },
          }),
        ).toBeUndefined();
      }
    });
  });

  describe("the message shown when one is run anyway", () => {
    it("states what happened and what to do about it", () => {
      const result = evaluatorUnavailability({
        evaluatorType: "presidio/pii_detection",
        env: { [PRESIDIO_ENABLE_ENV_VAR]: "false" },
      })!;
      const message = unavailableEvaluatorMessage({ unavailability: result });
      expect(message).toContain(result.reason);
      expect(message).toContain(result.howToEnable);
    });
  });

  describe("when the install skipped language detection", () => {
    const env = { [LINGUA_ENABLE_ENV_VAR]: "false" };

    it("reports it as not installed, naming the switch", () => {
      const result = evaluatorUnavailability({
        evaluatorType: "lingua/language_detection",
        env,
      });
      expect(result).toBeDefined();
      expect(result!.reason).toMatch(/not installed/i);
      expect(result!.howToEnable).toContain(LINGUA_ENABLE_ENV_VAR);
      // It stays visible as a disabled card; only deprecated families hide.
      expect(result!.isHiddenFromUi).toBeUndefined();
    });
  });

  describe("when the install skipped the legacy evaluators", () => {
    const env = { [LEGACY_EVALUATORS_ENABLE_ENV_VAR]: "false" };

    it("hides them from pickers entirely", () => {
      const result = evaluatorUnavailability({
        evaluatorType: "legacy/ragas_faithfulness",
        env,
      });
      expect(result).toBeDefined();
      expect(result!.isHiddenFromUi).toBe(true);
    });

    it("still explains itself when a saved evaluation runs one", () => {
      const result = evaluatorUnavailability({
        evaluatorType: "legacy/ragas_faithfulness",
        env,
      })!;
      const message = unavailableEvaluatorMessage({ unavailability: result });
      expect(message).toMatch(/not installed/i);
      expect(message).toContain(LEGACY_EVALUATORS_ENABLE_ENV_VAR);
    });

    it("does not touch the current ragas family", () => {
      expect(
        evaluatorUnavailability({ evaluatorType: "ragas/faithfulness", env }),
      ).toBeUndefined();
    });
  });
});
