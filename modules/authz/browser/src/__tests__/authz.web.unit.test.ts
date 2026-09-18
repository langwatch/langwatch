/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { authzWeb } from "../authz.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs authz", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([authzWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(authzWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the Roles component", async () => {
      const screen = authzWeb.installation.screens["pages/settings/roles"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the Role Bindings component", async () => {
      const screen = authzWeb.installation.screens["pages/settings/role-bindings"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
