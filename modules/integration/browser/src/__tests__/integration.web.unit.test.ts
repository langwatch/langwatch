/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { integrationWeb } from "../integration.web.ts";

describe("given a browser that installs integration", () => {
  describe("when the Integrations screen is asked for", () => {
    it("guards it on organization:view and answers with a component", async () => {
      const screen = integrationWeb.installation.screens["pages/settings/integrations"];
      const loaded = await screen?.load?.();

      expect(screen?.requires).toBe("organization:view");
      expect(loaded).toHaveProperty("default");
    });
  });
});
