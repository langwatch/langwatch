/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { billingWeb } from "../billing.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs billing", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([billingWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(billingWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it.each([
      ["pages/settings/plans"],
      ["pages/settings/subscription"],
      ["pages/settings/usage"],
    ] as const)("answers with a component for %s", async (page) => {
      const screen = billingWeb.installation.screens[page];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
