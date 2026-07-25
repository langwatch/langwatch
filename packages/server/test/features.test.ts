import { describe, expect, it } from "vitest";
import { LANGY_ENV_KEY, PRESIDIO_ENV_KEY, resolveFeatures } from "../src/shared/features.ts";

describe("optional install pieces", () => {
  describe("when nothing is set", () => {
    it("installs the assistant and skips the PII model", () => {
      const f = resolveFeatures({});
      expect(f.langy).toBe(true);
      expect(f.presidio).toBe(false);
    });
  });

  describe("when a toggle is set", () => {
    it("honours an explicit opt-in to the PII model", () => {
      expect(resolveFeatures({ [PRESIDIO_ENV_KEY]: "true" }).presidio).toBe(true);
    });

    it("honours an explicit opt-out of the assistant", () => {
      expect(resolveFeatures({ [LANGY_ENV_KEY]: "false" }).langy).toBe(false);
    });

    it("accepts the spellings people actually type", () => {
      for (const yes of ["1", "true", "TRUE", "yes", "on", " true "]) {
        expect(resolveFeatures({ [PRESIDIO_ENV_KEY]: yes }).presidio).toBe(true);
      }
      for (const no of ["0", "false", "FALSE", "no", "off"]) {
        expect(resolveFeatures({ [LANGY_ENV_KEY]: no }).langy).toBe(false);
      }
    });
  });

  describe("when a toggle is set to something unrecognised", () => {
    it("keeps the default rather than reading it as off", () => {
      // A typo silently stripping a feature someone asked for is the worse
      // failure: they wait for an install that quietly did not happen.
      expect(resolveFeatures({ [LANGY_ENV_KEY]: "maybe" }).langy).toBe(true);
      expect(resolveFeatures({ [PRESIDIO_ENV_KEY]: "sure" }).presidio).toBe(false);
    });

    it("treats an empty value as unset", () => {
      expect(resolveFeatures({ [LANGY_ENV_KEY]: "" }).langy).toBe(true);
    });
  });
});
