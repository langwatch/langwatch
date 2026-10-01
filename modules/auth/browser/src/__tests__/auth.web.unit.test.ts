/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { authWeb } from "../auth.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs auth", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([authWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(authWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it.each([
      ["pages/auth/signin"],
      ["pages/auth/signup"],
      ["pages/auth/forgot-password"],
      ["pages/auth/reset-password"],
      ["pages/auth/verify-email"],
      ["pages/auth/error"],
      ["pages/auth/join"],
      ["pages/invite/accept"],
    ] as const)("answers with a component for %s", async (page) => {
      const screen = authWeb.installation.screens[page];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
