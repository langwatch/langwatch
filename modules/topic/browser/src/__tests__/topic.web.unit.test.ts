/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { topicWeb } from "../topic.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs topic", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([topicWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(topicWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with a component", async () => {
      const screen = topicWeb.installation.screens["pages/settings/topic-clustering"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
