/**
 * @vitest-environment jsdom
 * Onboarding lends by the tokens in its client package, so a reader finds them without
 * importing onboarding's browser package or naming a capability (§10.1).
 */
import {
  FirstTouchAttributionToken,
  GuidedOnboardingOfferToken,
  GuidedPathActiveToken,
  GuidedTourStateToken,
  GuidedTourToken,
} from "@langwatch/onboarding-client";
import { describe, expect, it } from "vitest";

import { onboardingWeb } from "../onboarding.web.ts";

function lendOf({ key }: { key: string }) {
  return onboardingWeb.installation.lends.find(({ token }) => token.key === key);
}

describe("the onboarding browser declaration", () => {
  describe("when a reader looks up each token from onboarding's client", () => {
    /** @scenario Each wave 3 owner lends by its client tokens */
    it.each([GuidedOnboardingOfferToken])("loads the lent component for $key", async (token) => {
      const lend = lendOf(token);
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toHaveProperty("default");
    });
    /** @scenario Each wave 3 owner lends by its client tokens */
    it.each([
      FirstTouchAttributionToken,
      GuidedPathActiveToken,
      GuidedTourStateToken,
      GuidedTourToken,
    ])("lends the hooks for $key as an eager value", (token) => {
      const lend = lendOf(token);

      expect(lend && "value" in lend ? lend.value : undefined).toBeTypeOf("object");
    });
  });
});
