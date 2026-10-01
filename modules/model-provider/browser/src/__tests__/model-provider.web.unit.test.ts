/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { modelProviderWeb } from "../model-provider.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs model-provider", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([modelProviderWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(modelProviderWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the Model Providers component", async () => {
      const screen = modelProviderWeb.installation.screens["pages/settings/model-providers"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the Model Costs component", async () => {
      const screen = modelProviderWeb.installation.screens["pages/settings/model-costs"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
