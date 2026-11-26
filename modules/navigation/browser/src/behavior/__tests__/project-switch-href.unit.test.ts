/** Tests projectSwitchHref, which reads route boundaries from matched pattern instead of a table */

import { describe, expect, it } from "vitest";

import { projectPickHref, projectSwitchHref } from "../use-project-pick-groups.ts";

describe("projectSwitchHref", () => {
  describe("given I am on a project sub-route", () => {
    /** @scenario Picking a different project preserves the current sub-route */
    it("swaps the project slug and keeps the rest of the path", () => {
      expect(
        projectSwitchHref({
          pathname: "/acme-app/traces",
          routePattern: "/:project/traces",
          currentSlug: "acme-app",
          nextSlug: "beta",
        }),
      ).toBe("/beta/traces");
    });
  });

  describe("given I am on a project route that carries extra dynamic segments", () => {
    /** @scenario Picking a project from a route with extra dynamic segments */
    it("drops the trailing id and lands on the segment's parent route", () => {
      // A trace id can't exist in another project, so the pick drops to the
      // parent list route ("/beta/traces") rather than carrying it across
      // and building a 404ing per-project URL.
      expect(
        projectSwitchHref({
          pathname: "/acme-app/traces/trace_abc",
          routePattern: "/:project/traces/:traceId",
          currentSlug: "acme-app",
          nextSlug: "beta",
        }),
      ).toBe("/beta/traces");
    });
  });

  describe("given I am on a route with no project segment", () => {
    /** @scenario Picking a project from a non-project route falls back to project root */
    it("opens the target project's root", () => {
      expect(
        projectSwitchHref({
          pathname: "/settings/billing",
          routePattern: "/settings/billing",
          currentSlug: void 0,
          nextSlug: "beta",
        }),
      ).toBe("/beta");
    });
  });

  describe("given the address does not belong to the current project at all", () => {
    it("still opens the target project's root rather than rewriting an unrelated path", () => {
      expect(
        projectSwitchHref({
          pathname: "/other-project/traces",
          routePattern: "/:project/traces",
          currentSlug: "acme-app",
          nextSlug: "beta",
        }),
      ).toBe("/beta");
    });
  });
});

describe("projectPickHref", () => {
  const pick = (pathname: string, isProjectShared: boolean | null) =>
    projectPickHref({
      pathname,
      routePattern: "/:project/dashboards/:dashboardId",
      currentSlug: "shop",
      nextSlug: "beta",
      openBoard: isProjectShared === null ? null : { homeProduct: "llm-ops", isProjectShared },
    });

  describe("given a board that reads the project in view, at a project's address", () => {
    it("keeps the board open in the next project", () => {
      expect(pick("/shop/dashboards/board_1", false)).toBe("/beta/dashboards/board_1");
    });
  });

  describe("given a board shared with its project", () => {
    it.each(["/shop/dashboards/board_1", "/dashboards/board_1"])(
      "opens the next project's LLM Ops home from %s",
      (pathname) => {
        expect(pick(pathname, true)).toBe("/beta");
      },
    );
  });

  describe("given no board open", () => {
    it("keeps the project switch's own rule", () => {
      expect(pick("/shop/dashboards/board_1", null)).toBe("/beta/dashboards");
    });
  });
});
