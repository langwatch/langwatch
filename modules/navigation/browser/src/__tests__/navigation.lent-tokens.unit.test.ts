/**
 * @vitest-environment jsdom
 * Navigation lends by the tokens in its client package, so a reader finds them without
 * importing navigation's browser package or naming a capability (§10.1).
 */
import { InlineCommandPaletteToken, SidebarToken } from "@langwatch/navigation-client";
import { describe, expect, it } from "vitest";

import { navigationWeb } from "../navigation.web.ts";

function lendOf({ key }: { key: string }) {
  return navigationWeb.installation.lends.find(({ token }) => token.key === key);
}

describe("the navigation browser declaration", () => {
  describe("when a reader looks up each token from navigation's client", () => {
    /** @scenario Each wave 3 owner lends by its client tokens */
    it.each([InlineCommandPaletteToken])("loads the lent component for $key", async (token) => {
      const lend = lendOf(token);
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toHaveProperty("default");
    });
    /** @scenario Each wave 3 owner lends by its client tokens */
    it.each([SidebarToken])("lends the hooks for $key as an eager value", (token) => {
      const lend = lendOf(token);

      expect(lend && "value" in lend ? lend.value : undefined).toBeTypeOf("object");
    });
  });
});
