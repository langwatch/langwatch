/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { shareWeb } from "../share.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs share", () => {
  describe("when the kernel renders with no screen requirement to satisfy", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([shareWeb] as const)
        .render();

      expect(installed.modules).toContain(shareWeb);
    });
  });

  describe("when a surface the declaration publishes is asked for", () => {
    it.each([["share-link-views"], ["share-links"]] as const)(
      "resolves %s",
      async (surface) => {
        const publication = shareWeb.installation.publications[surface];
        const loaded = await publication?.load();

        expect(loaded).toBeDefined();
      },
    );
  });
});
