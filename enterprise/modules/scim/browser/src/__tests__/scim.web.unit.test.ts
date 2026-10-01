/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { describe, expect, it } from "vitest";

import { scimWeb } from "../scim.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs scim", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([scimWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(scimWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the Connectors component", async () => {
      const screen = scimWeb.installation.screens["pages/settings/authentication/connectors"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    /** Directory sync became the Directory; its old address redirects there. */
    it("declares no page for the retired SCIM address", () => {
      expect(scimWeb.installation.screens).not.toHaveProperty("pages/settings/scim");
    });
  });
});
