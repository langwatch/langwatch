/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { hostServiceFakes } from "@langwatch/browser/testing";
import { describe, expect, it } from "vitest";

import { notificationWeb } from "../notification.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs notification", () => {
  describe("when the kernel renders with a transport and the page's config supplied", () => {
    it("installs the module and projects the slice it claims", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([hostServiceFakes(), notificationWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .withInjectedConfig(() => ({
          process: { mode: "test", deployment: "self-hosted", nlp: true },
          notification: { email: true },
        }))
        .render();

      expect(installed.modules).toContain(notificationWeb);
      expect(installed.config).toEqual({ notification: { hasEmailProvider: true } });
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with a component", async () => {
      const screen = notificationWeb.installation.screens["pages/settings/email-suppressions"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
