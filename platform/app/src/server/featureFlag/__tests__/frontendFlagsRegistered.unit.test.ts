import { describe, expect, it } from "vitest";

import { FRONTEND_FEATURE_FLAGS } from "../frontendFeatureFlags";
import { resolveFlagDefinition } from "../registry";

/**
 * `server/api/routers/featureFlag.ts` casts `input.flag` to FeatureFlagKey,
 * so an unregistered frontend flag compiles clean and fails only at
 * runtime — quietly.
 *
 * The failure is not a wrong value (both the router and the service
 * normalize the default to false), it is a missing lever. `resolveFlagDefinition`
 * returning undefined is precisely the branch at featureFlag.service.ts:106
 * that sends a key down the legacy in-memory path, skipping the operator
 * store: /ops/feature-flags can then neither list nor write the flag, and
 * per-org targeting rules never apply. The flag becomes deploy-time and
 * fleet-wide, which is the opposite of what a rollout flag is for.
 *
 * This test calls `resolveFlagDefinition` rather than scanning FEATURE_FLAGS
 * directly, so it exercises the same predicate the service does — including
 * family-prefix matches — instead of a copy that can drift from it.
 *
 * The second check is a register, not a violation list. An earlier version
 * asserted that every frontend-exposed flag carries PRODUCT scope, on the
 * premise that the router's cast depended on it. It does not: the resolver
 * has no scope branch once a definition exists (featureFlag.service.ts:106
 * routes SYSTEM and PRODUCT into the same store call), the postgres store
 * evaluates targeting rules against `{ projectId, organizationId }` without
 * consulting scope at all, and FeatureFlagKey is the union of every
 * registered key regardless of scope. A SYSTEM flag read from the frontend
 * is a legitimate shape, and the Langy family uses it deliberately.
 *
 * What scope still decides is operator-facing: /ops/feature-flags groups by
 * it, badges it, and warns on PRODUCT rows. A misclassified scope therefore
 * misleads an operator rather than breaking a resolution, which is worth a
 * declaration in review but not a failure labelled "wrong scope".
 * See ADR-005 (Amendment: PostHog removed from the resolver).
 */

/**
 * Exact contents, not a count: pinning the members means swapping a key —
 * or adding one — shows up as a changed literal in review. It does not
 * prevent a future author from widening the list, it only makes widening
 * a deliberate, visible edit.
 */
const UNREGISTERED_GRANDFATHERED = ["ops_ui_ops_menu_pinned"];

/**
 * Frontend-exposed flags that are SYSTEM on purpose: internal levers
 * (`envOverridable: false`, operator-store-only) that happen to gate a
 * product surface. Order matters — the assertion compares the resolved set
 * against this array, so a new such flag lands here as a visible edit next
 * to the one in FRONTEND_FEATURE_FLAGS.
 */
const FRONTEND_SYSTEM_FLAGS = [
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

  describe("when a frontend flag resolves to a SYSTEM-scoped definition", () => {
    /** @scenario a flag the web UI can read is registered, so operators keep the lever */
    it("is one the register declares, so the classification stays reviewed", () => {
      const systemScoped = FRONTEND_FEATURE_FLAGS.filter(
        (key) => resolveFlagDefinition(key)?.scope === "SYSTEM",
      );

      expect(systemScoped).toEqual(FRONTEND_SYSTEM_FLAGS);
    });
  });

  describe("when the pinned lists are read", () => {
    /** @scenario a frontend flag missing from the registry is caught before it ships */
    it("names exactly the keys each one covers", () => {
      expect(UNREGISTERED_GRANDFATHERED).toEqual(["ops_ui_ops_menu_pinned"]);
      expect(FRONTEND_SYSTEM_FLAGS).toEqual([
        "release_langy_enabled",
        "release_langy_ui_actions",
      ]);
    });
  });
});
