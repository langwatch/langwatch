/**
 * @vitest-environment jsdom
 * Analytics lends its components by the tokens in its client package, so a reader
 * renders them without importing analytics's browser package (§10.1).
 */
import { FilterSidebarToken } from "@langwatch/analytics-client";
import { describe, expect, it } from "vitest";

import { analyticsWeb } from "../analytics.web.ts";

async function loadLent({ key }: { key: string }) {
  const lend = analyticsWeb.installation.lends.find(({ token }) => token.key === key);
  return lend && "load" in lend ? lend.load() : undefined;
}

describe("the analytics browser declaration", () => {
  describe("when a reader looks up each token from analytics's client", () => {
    /** @scenario Each wave 2 owner lends its components by its client tokens */
    it.each([FilterSidebarToken])("loads the lent component for $key", async (token) => {
      const loaded = await loadLent(token);

      expect(loaded).toHaveProperty("default");
    });
  });
});
