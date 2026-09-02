/**
 * The address on screen, written back as the route pattern the menu matches on.
 *
 * Every active-state test in the moved project menu was written against
 * `router.pathname` — the PATTERN, `/[project]/sessions`, not the address
 * `/acme-app/sessions`. The host answers with the address, because that is the
 * only thing a settings entry can be matched against. This is the seam that
 * lets both kinds of test keep the exact comparison they were written with, so
 * it is where a wrong answer lights the wrong menu entry.
 */

import { describe, expect, it } from "vitest";
import { projectNavItemAt, projectNavItems, toProjectRoutePattern } from "../project-nav-items";

describe("given an address inside the reader's project", () => {
  describe("when the project home is on screen", () => {
    it("writes it back as the bare project pattern", () => {
      expect(toProjectRoutePattern({ pathname: "/acme-app", projectSlug: "acme-app" })).toBe(
        "/[project]",
      );
    });
  });

  describe("when a page under the project is on screen", () => {
    it("keeps everything after the project segment", () => {
      expect(
        toProjectRoutePattern({ pathname: "/acme-app/simulations/scenarios", projectSlug: "acme-app" }),
      ).toBe("/[project]/simulations/scenarios");
    });
  });

  describe("when another project's slug starts with the reader's own", () => {
    /**
     * The segment boundary, the same trap the pick href has: a plain
     * `startsWith` turns `/acme-app-staging/traces` into
     * `/[project]-staging/traces`, which matches no entry and lights nothing.
     */
    it("matches on the segment boundary rather than the string", () => {
      expect(
        toProjectRoutePattern({ pathname: "/acme-app-staging/traces", projectSlug: "acme-app" }),
      ).toBe("/acme-app-staging/traces");
    });
  });
});

describe("given an address outside any project", () => {
  describe("when a settings page is on screen", () => {
    it("comes back unchanged, because it is already the pattern it matches on", () => {
      expect(toProjectRoutePattern({ pathname: "/settings/usage", projectSlug: "acme-app" })).toBe(
        "/settings/usage",
      );
    });
  });

  describe("when no project has resolved yet", () => {
    it("comes back unchanged rather than guessing a segment to replace", () => {
      expect(toProjectRoutePattern({ pathname: "/acme-app/traces", projectSlug: void 0 })).toBe(
        "/acme-app/traces",
      );
    });
  });
});

describe("given the document title's read of the open destination", () => {
  describe("when the address is one the project menu offers", () => {
    it("names it", () => {
      expect(projectNavItemAt("/[project]/prompts")).toEqual(projectNavItems.prompts);
    });
  });

  describe("when the address is a page the menu does not list", () => {
    /** The title then carries the project alone, which is what it did before. */
    it("names nothing rather than the closest guess", () => {
      expect(projectNavItemAt("/[project]/traces/abc123")).toBeUndefined();
    });
  });
});
