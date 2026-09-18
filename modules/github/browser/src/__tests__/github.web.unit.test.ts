/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { githubWeb } from "../github.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs github", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([githubWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(githubWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with a component", async () => {
      const screen = githubWeb.installation.screens["pages/settings/integrations"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
