/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { annotationWeb } from "../annotation.web.ts";

/** The shell's own shape, read where the reader's type names it. */
const publicAppConfig = () => ({
  appBaseUrl: "https://app.example.test",
  gatewayBaseUrl: "https://gateway.example.test",
  deployment: "self-hosted" as const,
  mode: "test" as const,
  telemetry: { browserTracing: false, sampleRatio: 0 },
  capabilities: { email: true, nlp: true, langevals: false },
  passkeys: false,
  identityFrontDoor: false,
});

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs annotation", () => {
  describe("when the supply reads the injected configuration", () => {
    it("hands the module the slice its declaration projected", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([annotationWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .withInjectedConfig(publicAppConfig)
        .render();

      expect(installed.config).toEqual({ annotation: { mode: "test" } });
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with a component", async () => {
      const screen = annotationWeb.installation.screens["pages/[project]/annotations/all"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });
});
