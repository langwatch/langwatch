/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { presenceWeb } from "../presence.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs presence", () => {
  describe("when the kernel renders with no screen requirement to satisfy", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([presenceWeb] as const)
        .render();

      expect(installed.modules).toContain(presenceWeb);
    });
  });

  describe("when the surface the declaration publishes is asked for", () => {
    it("resolves the presence store and components", async () => {
      const publication = presenceWeb.installation.publications.presence;
      const loaded = await publication?.load();

      expect(loaded).toBeDefined();
    });
  });
});
