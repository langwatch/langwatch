/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { HeroAskFieldToken, ProjectSwitcherToken } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { projectWeb } from "../project.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs project", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([projectWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(projectWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with the home component", async () => {
      const screen = projectWeb.installation.screens["pages/[project]/index"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });

    it("answers with the project settings component", async () => {
      const screen = projectWeb.installation.screens["pages/settings"];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });

  describe("when a peer asks for the project switcher", () => {
    it("lends the switcher component by project's token", async () => {
      const lend = projectWeb.installation.lends.find(
        (lent) => lent.token.key === ProjectSwitcherToken.key,
      );
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toHaveProperty("default", expect.any(Function));
    });
  });

  describe("when governance's hero asks for the ask field", () => {
    it("lends the inline command palette by project's token", async () => {
      const lend = projectWeb.installation.lends.find(
        (lent) => lent.token.key === HeroAskFieldToken.key,
      );
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toHaveProperty("default", expect.any(Function));
    });
  });
});
