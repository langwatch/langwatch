/** @vitest-environment jsdom */

import { createUi, hostServiceFakes } from "@langwatch/browser";
import { describe, expect, it } from "vitest";

import { billingWeb } from "../billing.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs billing", () => {
  describe("when the kernel renders with a transport and the page's config supplied", () => {
    it("installs the module and projects the slice it claims", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([hostServiceFakes(), billingWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .withInjectedConfig(() => ({
          process: { mode: "test", deployment: "self-hosted", nlp: true },
          billing: {},
        }))
        .render();

      expect(installed.modules).toContain(billingWeb);
      expect(installed.config).toEqual({ billing: {} });
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it.each([
      ["pages/settings/plans"],
      ["pages/settings/subscription"],
      ["pages/settings/usage"],
    ] as const)(
      "answers with a component for %s",
      async (page) => {
        const screen = billingWeb.installation.screens[page];
        const loaded = await screen?.load?.();

        expect(loaded).toHaveProperty("default");
      },
      30_000,
    );
  });
});
