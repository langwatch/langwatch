/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { resolveUiPageAccess } from "@langwatch/browser/page-guard";
import { describe, expect, it } from "vitest";

import { promptWeb } from "../prompt.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs prompt", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([promptWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(promptWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the Prompt Studio component", async () => {
      const screen = promptWeb.installation.screens["pages/[project]/prompts"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });

  describe("when the router opens the prompts address", () => {
    const requires = promptWeb.installation.screens["pages/[project]/prompts"]?.requires;
    const accessFor = (grants: readonly string[]) =>
      resolveUiPageAccess({
        ...(requires !== undefined ? { permission: requires } : {}),
        featureFlag: () => true,
        hasPermission: (needed) => grants.includes(needed),
        isSettled: () => true,
      });

    /** @scenario "Prompt Studio is behind the grant its platform page asked for" */
    it("requires prompts:view and names it to a reader without it", () => {
      expect(requires).toBe("prompts:view");
      expect(accessFor([])).toEqual({ kind: "forbidden", permission: "prompts:view" });
    });

    /** @scenario "Prompt Studio opens for a reader who may view prompts" */
    it("opens for a reader holding prompts:view", () => {
      expect(accessFor(["prompts:view"])).toEqual({ kind: "open" });
    });
  });
});
