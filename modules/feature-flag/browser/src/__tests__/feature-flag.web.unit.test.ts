/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { featureFlagWeb } from "../feature-flag.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs feature-flag", () => {
  describe("when the kernel renders with no screen requirement to satisfy", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([featureFlagWeb] as const)
        .render();

      expect(installed.modules).toContain(featureFlagWeb);
    });
  });

  describe("when the surface the declaration publishes is asked for", () => {
    it("resolves the operator catalogue view", async () => {
      const publication = featureFlagWeb.installation.publications["surfaces/experiment-catalogue"];
      const loaded = await publication?.load();

      expect(loaded).toBeDefined();
    });
  });
});
