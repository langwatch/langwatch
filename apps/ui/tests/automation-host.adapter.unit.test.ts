/**
 * The automations package's host port, answered from this application.
 *
 * The adapter is a value object over readings that have already happened, which
 * is what makes it assertable without a router, a transport or a document. What
 * is worth pinning is the one thing it SPELLS rather than forwards: the address
 * of a registered drawer.
 *
 * `@langwatch/automation-web` deliberately does not know that vocabulary. Its
 * screen names a drawer — `automation`, `viewAutomation` — and its own suite
 * asserts which one was asked for; turning that into
 * `?drawer.open=<name>&drawer.<key>=<value>` is composition, and composition is
 * here. So this is the only place the two halves meet, and the only place an
 * alert email's link and a row click can be shown to be the same address.
 *
 * THE STALE-KEY CASE IS THE ONE THAT BITES. `openDrawer` clears every `drawer.*`
 * key on the way, and without that a create opened from a page where the reader
 * had just been editing something opens on the thing they were editing.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DRAWER_OPEN_PARAM,
  UiAutomationHost,
} from "../src/features/automations/behavior/automation-host.adapter";

function host({
  query = {},
  actions = {},
}: {
  query?: Readonly<Record<string, string | undefined>>;
  actions?: Partial<Parameters<typeof UiAutomationHost.create>[1]>;
} = {}) {
  return UiAutomationHost.create(
    {
      scope: { organizationId: "org_acme", teamId: "team_1", projectId: "project_1" },
      organization: { id: "org_acme", name: "ACME", slug: "acme" },
      team: { id: "team_1", name: "Platform", slug: "platform" },
      project: { id: "project_1", name: "Checkout", slug: "checkout" },
      appBaseUrl: "https://app.langwatch.ai",
      route: { params: {}, query },
    },
    {
      hasPermission: () => false,
      featureFlag: () => false,
      setQuery: () => void 0,
      navigate: () => void 0,
      succeeded: () => void 0,
      failed: () => void 0,
      describeFailure: () => "",
      ...actions,
    },
  );
}

describe("given the automations host adapter", () => {
  describe("when the screen opens the editor on an automation", () => {
    it("writes the address the alert emails already mint", () => {
      const setQuery = vi.fn();

      host({ actions: { setQuery } }).openDrawer({
        drawer: "automation",
        params: { automationId: "trigger_1" },
      });

      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "automation",
        "drawer.automationId": "trigger_1",
      });
    });
  });

  describe("when the screen starts a new automation carrying prefills", () => {
    it("names the editor with no automation to load", () => {
      const setQuery = vi.fn();

      host({ actions: { setQuery } }).openDrawer({
        drawer: "automation",
        params: { initialSource: "customGraph", initialName: void 0 },
      });

      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "automation",
        "drawer.initialSource": "customGraph",
      });
    });
  });

  describe("when the viewer is open and the reader asks to edit", () => {
    it("drops the viewer's own parameters and keeps the page's", () => {
      const setQuery = vi.fn();

      host({
        query: {
          section: "alerts",
          "drawer.open": "viewAutomation",
          "drawer.automationId": "trigger_stale",
        },
        actions: { setQuery },
      }).openDrawer({ drawer: "automation", params: { automationId: "trigger_1" } });

      expect(setQuery).toHaveBeenCalledWith({
        section: "alerts",
        [DRAWER_OPEN_PARAM]: "automation",
        "drawer.automationId": "trigger_1",
      });
    });
  });
});
