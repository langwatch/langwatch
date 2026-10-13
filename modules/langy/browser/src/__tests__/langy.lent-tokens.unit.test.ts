/**
 * @vitest-environment jsdom
 * Langy lends by the tokens in its client package, so a reader finds them without
 * importing langy's browser package or naming a capability (§10.1).
 */
import { GuidedOnboardingToken } from "@langwatch/langy-client";
import { describe, expect, it } from "vitest";

import { langyWeb } from "../langy.web.ts";

function lendOf({ key }: { key: string }) {
  return langyWeb.installation.lends.find(({ token }) => token.key === key);
}

describe("the langy browser declaration", () => {
  describe("when a reader looks up each token from langy's client", () => {
    /** @scenario Each wave 3 owner lends by its client tokens */
    it.each([GuidedOnboardingToken])("lends the hooks for $key as an eager value", (token) => {
      const lend = lendOf(token);

      expect(lend && "value" in lend ? lend.value : undefined).toBeTypeOf("object");
    });
  });
});
