/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { dataPrivacyWeb } from "../data-privacy.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs data-privacy", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([dataPrivacyWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(dataPrivacyWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with a component", async () => {
      const screen = dataPrivacyWeb.installation.screens["pages/settings/data-privacy"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
