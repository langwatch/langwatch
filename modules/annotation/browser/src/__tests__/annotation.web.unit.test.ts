/** @vitest-environment jsdom */

import { createUi } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { annotationWeb } from "../annotation.web.ts";

/** The page's config as the api serves it: one slice per owner, by name. */
const publicAppConfig = () => ({
  process: {
    mode: "test",
    deployment: "self-hosted",
    nlp: true,
    browserTracing: false,
    sampleRatio: 0,
  },
});

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs annotation", () => {
  describe("when the supply reads the injected configuration", () => {
    it("hands the module the process owner's mode, and nothing else of that slice", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([annotationWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .withInjectedConfig(publicAppConfig)
        .render();

      expect(installed.config).toEqual({ annotation: { process: { mode: "test" } } });
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
