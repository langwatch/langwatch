import { describe, expect, it } from "vitest";
import {
  featureEnv,
  LANGY_ENV_KEY,
  LINGUA_ENV_KEY,
  PRESIDIO_ENV_KEY,
  resolveFeatures,
} from "../src/shared/features.ts";

describe("optional install pieces", () => {
  describe("when nothing is set", () => {
    it("installs the assistant and skips every heavyweight evaluator", () => {
      const f = resolveFeatures({});
      expect(f.isLangyEnabled).toBe(true);
      expect(f.isPresidioEnabled).toBe(false);
      expect(f.isLinguaEnabled).toBe(false);
    });
  });

  describe("when a toggle is set", () => {
    it("honours an explicit opt-in to the PII model", () => {
      expect(resolveFeatures({ [PRESIDIO_ENV_KEY]: "true" }).isPresidioEnabled).toBe(true);
    });

    it("honours an explicit opt-out of the assistant", () => {
      expect(resolveFeatures({ [LANGY_ENV_KEY]: "false" }).isLangyEnabled).toBe(false);
    });

    it("honours opting into language detection", () => {
      expect(resolveFeatures({ [LINGUA_ENV_KEY]: "true" }).isLinguaEnabled).toBe(true);
    });

    it("accepts the spellings people actually type", () => {
      for (const yes of ["1", "true", "TRUE", "yes", "on", " true "]) {
        expect(resolveFeatures({ [PRESIDIO_ENV_KEY]: yes }).isPresidioEnabled).toBe(true);
      }
      for (const no of ["0", "false", "FALSE", "no", "off"]) {
        expect(resolveFeatures({ [LANGY_ENV_KEY]: no }).isLangyEnabled).toBe(false);
      }
    });
  });

  describe("when a toggle is set to something unrecognised", () => {
    it("keeps the default rather than reading it as off", () => {
      // A typo silently stripping a feature someone asked for is the worse
      // failure: they wait for an install that quietly did not happen.
      expect(resolveFeatures({ [LANGY_ENV_KEY]: "maybe" }).isLangyEnabled).toBe(true);
      expect(resolveFeatures({ [PRESIDIO_ENV_KEY]: "sure" }).isPresidioEnabled).toBe(false);
    });

    it("treats an empty value as unset", () => {
      expect(resolveFeatures({ [LANGY_ENV_KEY]: "" }).isLangyEnabled).toBe(true);
    });
  });

  describe("featureEnv", () => {
    it("spells every toggle out so a child process never falls back to a default", () => {
      const env = featureEnv(resolveFeatures({ [PRESIDIO_ENV_KEY]: "true" }));
      expect(env).toEqual({
        [LANGY_ENV_KEY]: "true",
        [PRESIDIO_ENV_KEY]: "true",
        [LINGUA_ENV_KEY]: "false",
      });
    });
  });
});
