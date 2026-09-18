/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { governanceWeb } from "../governance.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs governance", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([governanceWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(governanceWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it.each([
      ["pages/governance/index"],
      ["pages/governance/inventory.enterprise"],
      ["pages/governance/ingestion-source-detail.enterprise"],
      ["pages/governance/anomaly-rules.enterprise"],
      ["pages/governance/people"],
      ["pages/governance/agents"],
      ["pages/governance/costs"],
      ["pages/governance/billed"],
      ["pages/governance/insights"],
      ["pages/governance/analytics"],
      ["pages/governance/signals"],
      ["pages/governance/teams"],
      ["pages/governance/teams/[id]"],
      ["pages/governance/users"],
      ["pages/governance/users/[id]"],
    ] as const)("answers with a component for %s", async (page) => {
      const screen = governanceWeb.installation.screens[page];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
