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
 * The frontend flags that resolve to NO registry definition on purpose.
 *
 * Being in `FRONTEND_FEATURE_FLAGS` does two things, and only one of them is
 * "readable through `featureFlag.isEnabled`": it is also the list the local
 * override machinery walks (`useFeatureFlagOverrides`, the Feature Flags (Dev)
 * drawer, `?ff_<flag>=on`). A flag that is only ever answered from this
 * browser's own override therefore belongs in the list and has nothing for a
 * registry definition to do — an operator lever at /ops/feature-flags would
 * be a switch wired to nothing, which is worse than no switch, because it
 * looks like the way to change the behaviour.
 *
 * Each member states why it is one, and each has its reason written beside it
 * in `frontendFeatureFlags.ts` too:
 *
 *   - `ops_ui_ops_menu_pinned` — a per-browser convenience for somebody who
 *     already has ops access. It widens nothing: the sidebar still gates on
 *     access, so forcing it On shows a non-ops user nothing.
 *
 * Exact contents, not a count: pinning the members means swapping a key —
 * or adding one — shows up as a changed literal in review. It does not
 * prevent a future author from widening the list, it only makes widening
 * a deliberate, visible edit.
 */
const UNREGISTERED_BY_DESIGN = ["ops_ui_ops_menu_pinned"];

/**
 * Frontend flags that CANNOT resolve to a registry definition, because the
 * surface they gate is reached SIGNED OUT.
 *
 * The registry exists to give operators a per-organization lever, and that
 * lever is read through `featureFlag.isEnabled` — a protected procedure that
 * answers 401, not false, to a visitor with no session. Registering one of
 * these would advertise a control that cannot be exercised where it matters,
 * so they resolve from the browser's own `?ff_<flag>=on` override and fall
 * back to a deployment environment variable instead.
 *
 * Separate from {@link UNREGISTERED_BY_DESIGN} on purpose: that list is
 * history nobody has cleaned up, this one is a design constraint. A flag
 * belongs here only if its surface genuinely has no session to check.
 *
 * Empty today. It held `release_ui_identity_front_door_enabled` while the new
 * front door was reached through a flag; the front door is the only one now,
 * so nothing gates it and there is nothing to exempt. The constraint outlives
 * its one member, so the list stays for the next signed-out surface.
 */
const SIGNED_OUT_FLAGS: readonly string[] = [];

/**
 * Frontend-exposed flags that are SYSTEM on purpose: internal levers
 * (`envOverridable: false`, operator-store-only) that happen to gate a
 * product surface. The assertion compares the resolved set against this
 * array order-independently, so reordering FRONTEND_FEATURE_FLAGS stays a
 * cosmetic edit; a new such flag still lands here as a visible one, next to
 * the one in FRONTEND_FEATURE_FLAGS.
 */
const FRONTEND_SYSTEM_FLAGS = [
  "release_langy_enabled",
  "release_langy_ui_actions",
];

describe("frontend feature flags", () => {
  describe("when a flag is exposed to the frontend via tRPC", () => {
    /** @scenario a flag the web UI can read is registered, so operators keep the lever */
    it("resolves to a registry definition so operators can target it per organization", () => {
      const unregistered = FRONTEND_FEATURE_FLAGS.filter(
        (key) =>
          !resolveFlagDefinition(key) &&
          !UNREGISTERED_BY_DESIGN.includes(key) &&
          !SIGNED_OUT_FLAGS.includes(key),
      );

      expect(unregistered).toEqual([]);
    });
  });

  describe("when a frontend flag resolves to a SYSTEM-scoped definition", () => {
    /** @scenario a frontend flag classified SYSTEM is declared, not discovered */
    it("is one the register declares, so the classification stays reviewed", () => {
      const systemScoped = FRONTEND_FEATURE_FLAGS.filter(
        (key) => resolveFlagDefinition(key)?.scope === "SYSTEM",
      );

      expect([...systemScoped].sort()).toEqual(
        [...FRONTEND_SYSTEM_FLAGS].sort(),
      );
    });
  });

  describe("when the exemption lists are read", () => {
    /**
     * The claim each list makes, asserted against the REGISTRY rather than
     * against a copy of itself.
     *
     * This used to compare both arrays to the same literals written in this
     * file, so it could not fail for any change to the product — only for an
     * edit to the two lines above it, which a reviewer is already looking at.
     * That mattered here: the exemption list was widened by this branch, and
     * the only test mentioning the widening was the one that could not fail.
     */
    it("exempts from the registry only flags the registry has no definition for", () => {
      // The claim `UNREGISTERED_BY_DESIGN` makes. A key that HAS a definition
      // has no business here: exempting it hides a lever that works.
      for (const key of UNREGISTERED_BY_DESIGN) {
        expect(resolveFlagDefinition(key)).toBeUndefined();
      }
      for (const key of SIGNED_OUT_FLAGS) {
        expect(resolveFlagDefinition(key)).toBeUndefined();
      }
    });

    it("keeps the system flags registered, because that is a different claim", () => {
      // `FRONTEND_SYSTEM_FLAGS` is not an exemption from the registry — it
      // says these DO resolve and are operator-store-only. Asserting the same
      // thing of both lists would collapse two different claims into one and
      // stop either being checked.
      for (const key of FRONTEND_SYSTEM_FLAGS) {
        expect(resolveFlagDefinition(key)).toBeDefined();
      }
    });
  });
});
