/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { apiKeyWeb } from "../api-key.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs api-key", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([apiKeyWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(apiKeyWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the Authorize component", async () => {
      const screen = apiKeyWeb.installation.screens["pages/authorize"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the MCP Authorize component", async () => {
      const screen = apiKeyWeb.installation.screens["pages/mcp/authorize"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the CLI Auth component", async () => {
      const screen = apiKeyWeb.installation.screens["pages/cli/auth"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the API Keys component", async () => {
      const screen = apiKeyWeb.installation.screens["pages/settings/api-keys"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
