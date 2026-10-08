/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { ResourceLimitRowToken } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { licensingWeb } from "../licensing.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs licensing", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([licensingWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(licensingWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the License component", async () => {
      const screen = licensingWeb.installation.screens["pages/settings/license"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    }, 30_000);
  });

  describe("when billing or organization reads the resourceLimitRow capability", () => {
    it("resolves the lent usage row", async () => {
      const lend = licensingWeb.installation.lends.find(
        ({ token }) => token.key === ResourceLimitRowToken.key,
      );
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toHaveProperty("default");
    }, 30_000);
  });
});
