/**
 * @vitest-environment jsdom
 * Agent lends its components by the tokens in its client package, so a reader
 * renders them without importing agent's browser package (§10.1).
 */
import { HttpConfigEditorToken } from "@langwatch/agent-client";
import { describe, expect, it } from "vitest";

import { agentWeb } from "../agent.web.ts";

async function loadLent({ key }: { key: string }) {
  const lend = agentWeb.installation.lends.find(({ token }) => token.key === key);
  return lend && "load" in lend ? lend.load() : undefined;
}

describe("the agent browser declaration", () => {
  describe("when a reader looks up each token from agent's client", () => {
    /** @scenario Each wave 2 owner lends its components by its client tokens */
    it.each([HttpConfigEditorToken])("loads the lent component for $key", async (token) => {
      const loaded = await loadLent(token);

      expect(loaded).toHaveProperty("default");
    });
  });
});
