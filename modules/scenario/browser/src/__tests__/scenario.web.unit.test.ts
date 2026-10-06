/**
 * @vitest-environment jsdom
 * Scenario lends its wired Talk to it panel and parameter line by token, so agent's
 * voice editor renders them without importing scenario's browser package.
 */
import { ParameterLineFieldToken, TalkToItPanelToken } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { LentTalkToItPanel } from "../features/talk-to-it/ui/sections/wired-talk-to-it-panel.tsx";
import { scenarioWeb } from "../scenario.web.ts";
import { LentParameterLineField } from "../ui/sections/agent-testing/run/lent-parameter-line-field.tsx";

async function loadLent({ key }: { key: string }) {
  const lend = scenarioWeb.installation.lends.find(({ token }) => token.key === key);
  return lend && "load" in lend ? lend.load() : undefined;
}

describe("the scenario browser declaration", () => {
  describe("when agent's voice editor reads the Talk to it panel token", () => {
    it("loads the wired call panel", async () => {
      const loaded = await loadLent(TalkToItPanelToken);

      expect(loaded).toHaveProperty("default", LentTalkToItPanel);
    });
  });

  describe("when agent's test panel reads the parameter line token", () => {
    it("loads the lent parameter line", async () => {
      const loaded = await loadLent(ParameterLineFieldToken);

      expect(loaded).toHaveProperty("default", LentParameterLineField);
    });
  });
});
