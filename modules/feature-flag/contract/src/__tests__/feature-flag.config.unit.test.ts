import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { featureFlagConfig } from "../feature-flag.config.ts";

const SYSTEM_FLAG = "ops_es_causality_loop_guard_disabled";
const NON_ENV_OVERRIDABLE_FLAG = "release_langy_enabled";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "feature-flag", config: featureFlagConfig }],
    environment,
  })["feature-flag"];

describe("feature flag server configuration", () => {
  describe("given the force-enable list", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("splits, trims and drops unregistered keys", () => {
      expect(
        read({ FEATURE_FLAG_FORCE_ENABLE: ` ${SYSTEM_FLAG} , not_a_flag ` }).forceEnable,
      ).toEqual([SYSTEM_FLAG]);
    });
  });

  describe("given a flag's derived variable", () => {
    it("reads 1 and 0 and leaves anything else absent", () => {
      const uppercased = "OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED";
      expect(read({ [uppercased]: "1" }).overrides[SYSTEM_FLAG]).toBe(true);
      expect(read({ [uppercased]: "0" }).overrides[SYSTEM_FLAG]).toBe(false);
      expect(read({ [uppercased]: "true" }).overrides[SYSTEM_FLAG]).toBeUndefined();
      expect(read({}).overrides[SYSTEM_FLAG]).toBeUndefined();
    });
  });

  describe("given a flag registered with envOverridable false", () => {
    it("contributes no leaf at all", () => {
      expect(read({}).overrides[NON_ENV_OVERRIDABLE_FLAG]).toBeUndefined();
      expect(Object.keys(read({}).overrides)).not.toContain(NON_ENV_OVERRIDABLE_FLAG);
    });
  });

  describe("given a flag's legacy alias", () => {
    it("reads its looser truthiness independently of the derived leaf", () => {
      const legacy = "LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD";
      expect(read({ [legacy]: "yes" }).legacy[SYSTEM_FLAG]).toBe(true);
      expect(read({ [legacy]: "0" }).legacy[SYSTEM_FLAG]).toBe(false);
      expect(read({ [legacy]: "false" }).legacy[SYSTEM_FLAG]).toBe(false);
      expect(read({}).legacy[SYSTEM_FLAG]).toBeUndefined();
    });
  });

  describe("given a flag with no legacy alias declared", () => {
    it("has no legacy leaf for it", () => {
      expect(Object.keys(read({}).legacy)).not.toContain("release_webhook_automations");
    });
  });
});
