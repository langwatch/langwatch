/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { hostServiceFakes } from "@langwatch/browser/testing";
import { describe, expect, it } from "vitest";

import { annotationWeb } from "../annotation.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs annotation", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module without reading the page's config", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([hostServiceFakes(), annotationWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.config).toEqual({});
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
