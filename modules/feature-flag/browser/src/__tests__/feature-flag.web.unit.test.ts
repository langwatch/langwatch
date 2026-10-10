/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
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
});
