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
 * The keys below are pinned rather than changed here; altering any of them
 * is a behavior change that belongs in its own PR, not in a test that
 * exists to stop the NEXT one. `release_langy_ui_actions` joined the
 * pinned list when merging main surfaced it alongside this check for the
 * first time (#7357 added the check, #7424 added the flag, independently
 * and concurrently) — same shape as the other grandfathered entries, just
 * discovered at merge time instead of at either PR's own review.
 */

/**
 * Exact contents, not a count: pinning the members means swapping a key —
 * or adding one — shows up as a changed literal in review. It does not
 * prevent a future author from widening the list, it only makes widening
 * a deliberate, visible edit.
 */
const UNREGISTERED_GRANDFATHERED = ["ops_ui_ops_menu_pinned"];

/**
 * Registered but deliberately not PRODUCT-scoped. `release_langy_enabled`
 * and `release_langy_ui_actions` are both SYSTEM with `envOverridable:
 * false` and both documented as "Managed only from the internal flag
 * store (/ops/feature-flags)", which reads as intentional.
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
    it("names exactly the keys that predate or are pinned by this check", () => {
      expect(UNREGISTERED_GRANDFATHERED).toEqual(["ops_ui_ops_menu_pinned"]);
      expect(NON_PRODUCT_GRANDFATHERED).toEqual([
        "release_langy_enabled",
        "release_langy_ui_actions",
      ]);
    });
  });
});
