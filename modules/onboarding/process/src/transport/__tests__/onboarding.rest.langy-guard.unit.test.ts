/**
 * @vitest-environment node
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { classifyForLangy } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { onboardingRest } from "../onboarding.rest.ts";

describe("given Langy reports a path as done with the conversation's key", () => {
  describe("when the guided state and completion routes declare their guards", () => {
    /** @scenario the REST routes are guarded by a permission Langy's own key can hold */
    it("declares only permissions the platform delegates to a Langy session key", () => {
      const routes = onboardingRest.router().routes;
      expect(routes).toHaveLength(2);
      for (const route of routes) {
        expect(route.permission).toBeDefined();
        const permission = String(route.permission);
        expect({ permission, ...classifyForLangy(permission) }).toMatchObject({
          permission,
          disposition: "granted",
        });
      }
    });
  });
});
