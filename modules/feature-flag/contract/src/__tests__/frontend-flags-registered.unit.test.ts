import { describe, expect, it } from "vitest";

import { FEATURE_FLAG_REGISTRY } from "../feature-flag-registry.ts";
import { UnknownFeatureFlagError } from "../feature-flag.errors.ts";
import type { FeatureFlagDefinition } from "../feature-flag.ts";
import { FRONTEND_FEATURE_FLAGS } from "../frontend-feature-flags.ts";

/**
 * Frontend-exposed flags that are SYSTEM on purpose: internal levers
 * (`envOverridable: false`, operator-store-only) that happen to gate a
 * product surface. See feature-flag.ts's own comments on each key.
 */
const FRONTEND_SYSTEM_FLAGS = [
  "release_custom_chart_playground",
  "release_langy_enabled",
  "release_langy_ui_actions",
];

function definitionOf(key: string): FeatureFlagDefinition | "unregistered" {
  try {
    return FEATURE_FLAG_REGISTRY.getDefinition(key);
  } catch (error) {
    if (error instanceof UnknownFeatureFlagError) return "unregistered";
    throw error;
  }
}

describe("frontend feature flags", () => {
  describe("when a flag is exposed to the frontend via tRPC", () => {
    /** @scenario "a flag the web UI can read is registered, so operators keep the lever" */
    it("resolves to a registry definition so operators can target it per organization", () => {
      const unregistered = FRONTEND_FEATURE_FLAGS.filter(
        (key) => definitionOf(key) === "unregistered",
      );

      expect(unregistered).toEqual([]);
    });
  });

  describe("when a frontend flag resolves to a SYSTEM-scoped definition", () => {
    /** @scenario "a frontend flag classified SYSTEM is declared, not discovered" */
    it("is one the register declares, so the classification stays reviewed", () => {
      const systemScoped = FRONTEND_FEATURE_FLAGS.filter((key) => {
        const definition = definitionOf(key);
        return definition !== "unregistered" && definition.scope === "SYSTEM";
      });

      expect([...systemScoped].toSorted()).toEqual([...FRONTEND_SYSTEM_FLAGS].toSorted());
    });
  });
});
