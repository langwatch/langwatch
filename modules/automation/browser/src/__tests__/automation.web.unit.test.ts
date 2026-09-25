/** @vitest-environment jsdom */

import { createUi, installedDrawerLoaders } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { automationWeb } from "../automation.web.ts";
import { AutomationDrawer } from "../features/authoring/ui/sections/automation-drawer.tsx";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs automation", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([automationWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(automationWeb);
    });
  });

  describe("when an address names the automation drawer, as a chart's alert bell writes it", () => {
    it("answers with the automation drawer", async () => {
      const loaded = await installedDrawerLoaders([automationWeb]).automation?.();

      expect(loaded).toEqual({ default: AutomationDrawer });
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it("answers with a component for every declared tab", async () => {
      const pages = [
        "pages/[project]/automations",
        "pages/[project]/automations/automations",
        "pages/[project]/automations/alerts",
        "pages/[project]/automations/schedules",
      ] as const;

      for (const page of pages) {
        const screen = automationWeb.installation.screens[page];
        const loaded = await screen?.load?.();
        expect(loaded).toHaveProperty("default");
      }
    });
  });
});
