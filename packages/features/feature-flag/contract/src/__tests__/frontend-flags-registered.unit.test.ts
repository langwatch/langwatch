import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_REGISTRY } from "../feature-flag-registry";
import { FRONTEND_FEATURE_FLAGS } from "../frontend-feature-flags";

/**
 * Frontend-exposed flags that are SYSTEM on purpose: internal levers
 * (`envOverridable: false`, operator-store-only) that happen to gate a
 * product surface. See feature-flag.ts's own comments on each key.
 */
const FRONTEND_SYSTEM_FLAGS = ["release_langy_enabled", "release_langy_ui_actions"];

describe("frontend feature flags", () => {
  describe("when a flag is exposed to the frontend via tRPC", () => {
    /** @scenario "a flag the web UI can read is registered, so operators keep the lever" */
    it("resolves to a registry definition so operators can target it per organization", () => {
      const unregistered = FRONTEND_FEATURE_FLAGS.filter((key) => !FEATURE_FLAG_REGISTRY.resolve(key));

      expect(unregistered).toEqual([]);
    });
  });

  describe("when a frontend flag resolves to a SYSTEM-scoped definition", () => {
    /** @scenario "a frontend flag classified SYSTEM is declared, not discovered" */
    it("is one the register declares, so the classification stays reviewed", () => {
      const systemScoped = FRONTEND_FEATURE_FLAGS.filter(
        (key) => FEATURE_FLAG_REGISTRY.resolve(key)?.scope === "SYSTEM",
      );

      expect([...systemScoped].sort()).toEqual([...FRONTEND_SYSTEM_FLAGS].sort());
    });
  });
});
