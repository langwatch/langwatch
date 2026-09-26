/**
 * @vitest-environment jsdom
 * Scenario lends its wired Talk to it panel through the declaration, so agent's
 * voice editor renders the call without importing scenario's browser package.
 */
import { describe, expect, it } from "vitest";

import { LentTalkToItPanel } from "../features/talk-to-it/ui/sections/wired-talk-to-it-panel.tsx";
import { scenarioWeb } from "../scenario.web.ts";
import { LentParameterLineField } from "../ui/sections/agent-testing/run/lent-parameter-line-field.tsx";

describe("the scenario browser declaration", () => {
  describe("when agent's voice editor reads the talkToItPanel capability", () => {
    it("loads the wired call panel", async () => {
      const loaded = await scenarioWeb.installation.capabilities.talkToItPanel.load();

      expect(loaded.default).toBe(LentTalkToItPanel);
    });
  });

  describe("when agent's test panel reads the parameterLineField capability", () => {
    it("loads the lent parameter line", async () => {
      const loaded = await scenarioWeb.installation.capabilities.parameterLineField.load();

      expect(loaded.default).toBe(LentParameterLineField);
    });
  });
});
