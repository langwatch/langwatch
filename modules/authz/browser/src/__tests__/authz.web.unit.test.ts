/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { describe, expect, it } from "vitest";

import { authzWeb } from "../authz.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs authz", () => {
  describe("when the kernel renders with a transport and the page's config supplied", () => {
    it("installs the module and projects the slice it claims", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([authzWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .withInjectedConfig(() => ({
          process: { mode: "test", deployment: "self-hosted", nlp: true },
          authz: { demoProjectSlug: "demo" },
        }))
        .render();

      expect(installed.modules).toContain(authzWeb);
      expect(installed.config).toEqual({ authz: { demoProjectSlug: "demo" } });
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the Roles component", async () => {
      const screen = authzWeb.installation.screens["pages/settings/roles"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    /** Role Bindings became the Roles page's assignments tab; its address redirects. */
    it("declares no page for the retired Role Bindings address", () => {
      expect(authzWeb.installation.screens).not.toHaveProperty("pages/settings/role-bindings");
    });
  });
});
