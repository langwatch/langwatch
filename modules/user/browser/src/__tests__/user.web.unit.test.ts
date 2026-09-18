/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { userWeb } from "../user.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs user", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([userWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(userWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the personal overview component", async () => {
      const screen = userWeb.installation.screens["pages/me/index"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the personal configure component", async () => {
      const screen = userWeb.installation.screens["pages/me/configure"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the personal pull requests component", async () => {
      const screen = userWeb.installation.screens["pages/me/pull-requests"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the personal sessions component", async () => {
      const screen = userWeb.installation.screens["pages/me/sessions"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the personal budget request component", async () => {
      const screen = userWeb.installation.screens["pages/me/budget/request"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the Profile component", async () => {
      const screen = userWeb.installation.screens["pages/settings/profile"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the Security component", async () => {
      const screen = userWeb.installation.screens["pages/settings/security"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
