/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { describe, expect, it } from "vitest";

import { governanceWeb } from "../governance.web.ts";
import {
  readSampleChoice,
  subscribeToSampleChoice,
  writeSampleChoice,
} from "../ui/elements/governance-sample-mode.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs governance", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([governanceWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(governanceWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it.each([
      ["pages/governance/index"],
      ["pages/governance/inventory.enterprise"],
      ["pages/governance/ingestion-source-detail.enterprise"],
      ["pages/governance/people"],
      ["pages/governance/agents"],
      ["pages/governance/costs"],
      ["pages/governance/billed"],
      ["pages/governance/insights"],
      ["pages/governance/analytics"],
      ["pages/governance/signals"],
      ["pages/governance/teams"],
      ["pages/governance/teams/[id]"],
      ["pages/governance/users/[id]"],
    ] as const)(
      "answers with a component for %s",
      async (page) => {
        const screen = governanceWeb.installation.screens[page];
        const loaded = await screen?.load?.();

        expect(loaded).toHaveProperty("default");
      },
      30_000,
    );
  });

  describe("when the guided tour shows and then hides sample data", () => {
    /** @scenario The sample-data choice is offered as a capability, not an import */
    it("writes the sample choice every governance page reads", () => {
      const { sampleChoice } = governanceWeb.installation.capabilities;

      sampleChoice.setSampleChoice(true);
      expect(readSampleChoice()).toBe(true);

      sampleChoice.setSampleChoice(false);
      expect(readSampleChoice()).toBe(false);
      writeSampleChoice(null);
    });
  });

  describe("when the tour sets the choice and then forgets it through the capability", () => {
    /** @scenario The sample-data choice is offered as a capability, not an import */
    it("follows the choice, returns to the default, and tells every mounted affordance each time", () => {
      const { sampleChoice } = governanceWeb.installation.capabilities;
      let heard = 0;
      const unsubscribe = subscribeToSampleChoice(() => {
        heard += 1;
      });

      try {
        sampleChoice.setSampleChoice(true);
        expect(readSampleChoice()).toBe(true);
        expect(heard).toBe(1);

        sampleChoice.setSampleChoice(null);
        expect(readSampleChoice()).toBeNull();
        expect(heard).toBe(2);
      } finally {
        unsubscribe();
        writeSampleChoice(null);
      }
    });
  });
});
