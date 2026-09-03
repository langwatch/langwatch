/**
 * The address a registered automations drawer opens at.
 *
 * `@langwatch/automation-web` deliberately does not know this vocabulary. Its
 * screen names a drawer — `automation`, `viewAutomation` — and turning that
 * into `?drawer.open=<name>&drawer.<key>=<value>` is composition, and this is
 * the only place an alert email's link and a row click can be shown to be the
 * same address.
 *
 * THE STALE-KEY CASE IS THE ONE THAT BITES. `resolveAutomationsDrawerAddress`
 * clears every `drawer.*` key on the way, and without that a create opened
 * from a page where the reader had just been editing something opens on the
 * thing they were editing.
 */

import { describe, expect, it } from "vitest";
import { resolveAutomationsDrawerAddress } from "../src/features/automations/behavior/automations-drawer-address";

describe("given the automations drawer address", () => {
  describe("when the screen opens the editor on an automation", () => {
    it("writes the address the alert emails already mint", () => {
      const next = resolveAutomationsDrawerAddress({
        query: {},
        drawer: "automation",
        openParam: "drawer.open",
        params: { automationId: "trigger_1" },
      });

      expect(next).toEqual({
        "drawer.open": "automation",
        "drawer.automationId": "trigger_1",
      });
    });
  });

  describe("when the screen starts a new automation carrying prefills", () => {
    it("names the editor with no automation to load", () => {
      const next = resolveAutomationsDrawerAddress({
        query: {},
        drawer: "automation",
        openParam: "drawer.open",
        params: { initialSource: "customGraph", initialName: void 0 },
      });

      expect(next).toEqual({
        "drawer.open": "automation",
        "drawer.initialSource": "customGraph",
      });
    });
  });

  describe("when the viewer is open and the reader asks to edit", () => {
    it("drops the viewer's own parameters and keeps the page's", () => {
      const next = resolveAutomationsDrawerAddress({
        query: {
          section: "alerts",
          "drawer.open": "viewAutomation",
          "drawer.automationId": "trigger_stale",
        },
        drawer: "automation",
        openParam: "drawer.open",
        params: { automationId: "trigger_1" },
      });

      expect(next).toEqual({
        section: "alerts",
        "drawer.open": "automation",
        "drawer.automationId": "trigger_1",
      });
    });
  });
});
