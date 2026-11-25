/**
 * The host and analytics the Dashboards section in Gateway and Coding agents works through.
 * @see modules/navigation/specs/product-sidebars.feature
 */
import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../testing.tsx";
import { analyticsHostInProject, uiAnalyticsInProject } from "../analytics-host-in-project.ts";

const PAGE = { id: "proj-page", slug: "page", name: "Page", hasFirstMessage: true };
const SHOP = { id: "proj-shop", slug: "shop", name: "Shop" };

/** A destination that keeps its registered properties and records each event with them. */
class RegisteringUiAnalytics extends UiAnalytics {
  readonly properties = new Map<string, unknown>();
  readonly sent: { event: UiAnalyticsEvent; projectId: unknown }[] = [];

  track(event: UiAnalyticsEvent): void {
    this.sent.push({ event, projectId: this.properties.get("projectId") });
  }

  override register(properties: Readonly<Record<string, unknown>>): void {
    for (const [name, value] of Object.entries(properties)) this.properties.set(name, value);
  }

  override unregister(property: string): void {
    this.properties.delete(property);
  }

  identify(): void {}

  group(): void {}

  reset(): void {}
}

describe("analyticsHostInProject()", () => {
  describe("given the named project is the page's own", () => {
    describe("when the section asks for a permission there", () => {
      /** @scenario "In Gateway or Coding agents, the page's own project answers from the page's grants" */
      it("answers from the page's grants, not from a read of that project's grants", () => {
        const host = new StubAnalyticsHost({
          project: PAGE,
          permissions: ["analytics:create"],
          projectPermissions: { [PAGE.id]: ["analytics:delete"] },
        });

        const inProject = analyticsHostInProject({ host, project: PAGE });

        expect(inProject.hasPermission("analytics:create")).toBe(true);
        expect(inProject.hasPermission("analytics:delete")).toBe(false);
      });
    });
  });

  describe("given the named project is not the page's own", () => {
    describe("when the section asks for a permission there", () => {
      /** @scenario "In Gateway or Coding agents, the page's own project answers from the page's grants" */
      it("answers from that project's own grants, not the page's", () => {
        const host = new StubAnalyticsHost({
          project: PAGE,
          permissions: ["analytics:create"],
          projectPermissions: { [SHOP.id]: ["analytics:view"] },
        });

        const inProject = analyticsHostInProject({ host, project: SHOP });

        expect(inProject.project()?.id).toBe(SHOP.id);
        expect(inProject.hasPermission("analytics:view")).toBe(true);
        expect(inProject.hasPermission("analytics:create")).toBe(false);
      });
    });
  });
});

describe("uiAnalyticsInProject()", () => {
  describe("given the page is about its own project", () => {
    describe("when the section tracks an event", () => {
      /** @scenario "Events from the Dashboards section in Gateway or Coding agents are about the named project" */
      it("sends it about the named project, then puts the page's project back", () => {
        const analytics = new RegisteringUiAnalytics();
        analytics.register({ projectId: PAGE.id });
        const inProject = uiAnalyticsInProject({
          analytics,
          projectId: SHOP.id,
          pageProjectId: PAGE.id,
        });

        inProject.track({ name: "dashboard", action: "created" });
        analytics.track({ name: "page", action: "viewed" });

        expect(analytics.sent.map(({ projectId }) => projectId)).toEqual([SHOP.id, PAGE.id]);
      });
    });
  });

  describe("given the page is about no project", () => {
    describe("when the section tracks an event", () => {
      /** @scenario "Events from the Dashboards section in Gateway or Coding agents are about the named project" */
      it("sends it about the named project, then leaves later events about no project", () => {
        const analytics = new RegisteringUiAnalytics();
        const inProject = uiAnalyticsInProject({
          analytics,
          projectId: SHOP.id,
          pageProjectId: undefined,
        });

        inProject.track({ name: "dashboard", action: "created" });
        analytics.track({ name: "page", action: "viewed" });

        expect(analytics.sent.map(({ projectId }) => projectId)).toEqual([SHOP.id, undefined]);
        expect(analytics.properties.has("projectId")).toBe(false);
      });
    });
  });
});
