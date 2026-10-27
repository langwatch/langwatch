/**
 * @vitest-environment jsdom
 * Experiment lends its components by the tokens in its client package, so a reader
 * renders them without importing experiment's browser package (§10.1).
 */
import { ComparisonConfigFormToken } from "@langwatch/experiment-client";
import { describe, expect, it } from "vitest";

import { experimentWeb } from "../experiment.web.ts";

async function loadLent({ key }: { key: string }) {
  const lend = experimentWeb.installation.lends.find(({ token }) => token.key === key);
  return lend && "load" in lend ? lend.load() : undefined;
}

describe("the experiment browser declaration", () => {
  describe("when a reader looks up each token from experiment's client", () => {
    /** @scenario Each wave 2 owner lends its components by its client tokens */
    it.each([ComparisonConfigFormToken])("loads the lent component for $key", async (token) => {
      const loaded = await loadLent(token);

      expect(loaded).toHaveProperty("default");
    });
  });
});
