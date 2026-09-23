/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { codingAgentWeb } from "../coding-agent.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs coding-agent", () => {
  describe("when the kernel renders with no screen requirement to satisfy", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([codingAgentWeb] as const)
        .render();

      expect(installed.modules).toContain(codingAgentWeb);
    });
  });

  describe("when a surface the declaration publishes is asked for", () => {
    it.each([["surfaces/activity"]] as const)("resolves %s", async (surface) => {
      const publication = codingAgentWeb.installation.publications[surface];
      const loaded = await publication?.load();

      expect(loaded).toBeDefined();
    });
  });
});
