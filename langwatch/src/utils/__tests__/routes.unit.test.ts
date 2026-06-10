/**
 * @see specs/features/suites/rename-suites-to-runs.feature - Route title scenarios
 * @see specs/ai-gateway/governance/workspace-switcher.feature - Project switch routing
 */
import { describe, expect, it } from "vitest";
import { buildProjectSwitchHref, projectRoutes } from "../routes";

describe("projectRoutes", () => {
  describe("when the suites route configuration is read", () => {
    /** @scenario 'Route title is "Run Plans"' */
    it("has title 'Run Plans'", () => {
      expect(projectRoutes.suites.title).toBe("Run Plans");
    });
  });

  describe("when the simulation runs route configuration is read", () => {
    it("has title 'Runs'", () => {
      expect(projectRoutes.simulation_runs.title).toBe("Runs");
    });
  });
});

describe("buildProjectSwitchHref", () => {
  describe("given a project-anchored route", () => {
    /** @scenario Picking a different project preserves the current sub-route */
    it("swaps the slug and keeps the same sub-route", () => {
      expect(
        buildProjectSwitchHref({
          routePattern: "/[project]/messages",
          resolvedPathname: "/acme/messages",
          currentProjectSlug: "acme",
          targetSlug: "globex",
          homeFallback: "plain",
        }),
      ).toBe("/globex/messages");
    });

    /** @scenario Picking a project from a route with extra dynamic segments */
    it("drops to the parent list route when the route has a second dynamic segment", () => {
      // A trace id can't exist in another project, so the switch lands on the
      // target project's messages list rather than a 404ing per-trace URL.
      expect(
        buildProjectSwitchHref({
          routePattern: "/[project]/messages/[trace]",
          resolvedPathname: "/acme/messages/trace_abc",
          currentProjectSlug: "acme",
          targetSlug: "globex",
          homeFallback: "plain",
        }),
      ).toBe("/globex/messages");
    });

    it("preserves the home route itself when on /[project]", () => {
      expect(
        buildProjectSwitchHref({
          routePattern: "/[project]",
          resolvedPathname: "/acme",
          currentProjectSlug: "acme",
          targetSlug: "globex",
          homeFallback: "plain",
        }),
      ).toBe("/globex");
    });
  });

  describe("given an org-scoped or personal route with no per-project view", () => {
    /** @scenario Picking a project from a non-project route falls back to project root */
    it("lands on the project home with the plain fallback", () => {
      // The org-scope WorkspaceSwitcher wants a clean home, no return_to bounce.
      expect(
        buildProjectSwitchHref({
          routePattern: "/settings/members",
          resolvedPathname: "/settings/members",
          targetSlug: "globex",
          homeFallback: "plain",
        }),
      ).toBe("/globex");
    });

    it("appends return_to with the returnTo fallback (legacy ProjectSelector)", () => {
      expect(
        buildProjectSwitchHref({
          routePattern: "/settings/members",
          resolvedPathname: "/settings/members",
          targetSlug: "globex",
          homeFallback: "returnTo",
        }),
      ).toBe("/globex?return_to=%2Fsettings%2Fmembers");
    });
  });

  describe("given a non-[project] route that still embeds the current slug", () => {
    it("replaces the slug in place", () => {
      expect(
        buildProjectSwitchHref({
          routePattern: "/share/[id]",
          resolvedPathname: "/share/acme-export",
          currentProjectSlug: "acme",
          targetSlug: "globex",
          homeFallback: "plain",
        }),
      ).toBe("/share/globex-export");
    });
  });
});
