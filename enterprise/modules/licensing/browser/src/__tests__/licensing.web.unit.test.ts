/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { licensingWeb } from "../licensing.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs licensing", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([licensingWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(licensingWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the License component", async () => {
      const screen = licensingWeb.installation.screens["pages/settings/license"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });

  describe("when a surface the declaration publishes is asked for", () => {
    it("resolves the resource-limits surface", async () => {
      const publication = licensingWeb.installation.publications["surfaces/resource-limits"];
      const loaded = await publication?.load();

      expect(loaded).toBeDefined();
    });
  });
});
