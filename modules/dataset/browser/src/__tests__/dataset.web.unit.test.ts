/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { datasetWeb } from "../dataset.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs dataset", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([datasetWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(datasetWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the datasets list component", async () => {
      const screen = datasetWeb.installation.screens["pages/[project]/datasets"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the dataset editor component", async () => {
      const screen = datasetWeb.installation.screens["pages/[project]/datasets/[id]"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
