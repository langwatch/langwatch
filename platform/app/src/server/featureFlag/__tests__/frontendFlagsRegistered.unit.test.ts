import { describe, expect, it } from "vitest";

import { FRONTEND_FEATURE_FLAGS } from "../frontendFeatureFlags";
import { resolveFlagDefinition } from "../registry";

/**
 * `server/api/routers/featureFlag.ts` documents FRONTEND_FEATURE_FLAGS as
 * "a subset of registered PRODUCT keys" and casts `input.flag` to
 * FeatureFlagKey on that basis, so an unregistered frontend flag compiles
 * clean and fails only at runtime — quietly.
 *
 * The failure is not a wrong value (both the router and the service
 * normalize the default to false), it is a missing lever. `resolveFlagDefinition`
 * returning undefined is precisely the branch at featureFlag.service.ts:82
 * that sends a key down the legacy in-memory path, skipping the operator
 * store: /ops/feature-flags can then neither list nor write the flag, and
 * per-org targeting rules never apply. The flag becomes deploy-time and
 * fleet-wide, which is the opposite of what a rollout flag is for.
 *
 * These tests call `resolveFlagDefinition` rather than scanning FEATURE_FLAGS
 * directly, so they exercise the same predicate the service does — including
 * family-prefix matches — instead of a copy that can drift from it.
 *
 * The keys pinned below are listed rather than changed here; altering one is
 * a behavior change that belongs in its own PR, not in a test that exists to
 * stop the NEXT one.
 */

/**
 * Exact contents, not a count: pinning the members means swapping a key —
 * or adding one — shows up as a changed literal in review. It does not
 * prevent a future author from widening the list, it only makes widening
 * a deliberate, visible edit.
 */
const UNREGISTERED_GRANDFATHERED = ["ops_ui_ops_menu_pinned"];

/**
 * Registered but deliberately not PRODUCT-scoped. Both are SYSTEM with
 * `envOverridable: false` and are managed from the internal flag store only,
 * which reads as intentional in each description.
 *
 * SYSTEM costs these two nothing that the router's cast promises: the service
 * takes ONE branch for both scopes (`featureFlag.service.ts`), so a SYSTEM
 * flag is read from the operator store with the same per-project and per-org
 * targeting, and the registry says so as well ("both scopes resolve
 * identically today"). The branch this test really guards is the one for
 * UNREGISTERED keys, and the first test above is what holds it.
 */
const NON_PRODUCT_GRANDFATHERED = [
  "release_langy_enabled",
  "release_langy_ui_actions",
];

describe("frontend feature flags", () => {
  describe("when a flag is exposed to the frontend via tRPC", () => {
    it("resolves to a registry definition so operators can target it per organization", () => {
      const unregistered = FRONTEND_FEATURE_FLAGS.filter(
        (key) =>
          !resolveFlagDefinition(key) &&
          !UNREGISTERED_GRANDFATHERED.includes(key),
      );

      expect(unregistered).toEqual([]);
    });
  });

  describe("when the definition backing a frontend flag is resolved", () => {
    it("carries PRODUCT scope, the one the router's cast claims", () => {
      const wrongScope = FRONTEND_FEATURE_FLAGS.filter((key) => {
        const definition = resolveFlagDefinition(key);
        return (
          definition &&
          definition.scope !== "PRODUCT" &&
          !NON_PRODUCT_GRANDFATHERED.includes(key)
        );
      });

      expect(wrongScope).toEqual([]);
    });
  });

  describe("when the grandfathered exceptions are listed", () => {
    it("names exactly the keys this check allows through", () => {
      expect(UNREGISTERED_GRANDFATHERED).toEqual(["ops_ui_ops_menu_pinned"]);
      expect(NON_PRODUCT_GRANDFATHERED).toEqual([
        "release_langy_enabled",
        "release_langy_ui_actions",
      ]);
    });
  });
});
