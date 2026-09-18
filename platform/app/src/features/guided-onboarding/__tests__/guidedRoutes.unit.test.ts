/**
 * @vitest-environment jsdom
 *
 * Every address the guided onboarding sends the browser to, resolved against
 * the application's real route table: the landing after the sign-up, the
 * page Langy starts from, every tour step that navigates, and the page
 * names Langy's own navigate command can open. An address that matches only
 * the catch-all is a 404 in the demo, and this is where it fails instead.
 *
 * createBrowserRouter touches `document` while building the router, so the
 * file runs under jsdom even though it only matches paths, never renders.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { router } from "~/routes";
import {
  NAVIGATE_ORGANIZATION_PAGES,
  NAVIGATE_PROJECT_PAGES,
} from "~/server/app-layer/langy/streaming/langyNavigatePages";
import { guidedLandingRoute } from "../landing";
import { GUIDED_PATHS, guidedPathLanding } from "../paths";
import { TOUR_STEPS, type TourStepContext } from "../tour/tourSteps";

const PROJECT_SLUG = "acme-checkout";

/** The pattern of the route a path lands on, or null when nothing matches it. */
function leafRoutePattern(address: string): string | null {
  const { pathname } = new URL(address, "http://localhost");
  const matches = matchRoutes(router.routes, pathname);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1]!.route.path ?? null;
}

/**
 * A registered page: the address matched a route of its own, not the 404
 * catch-all at the end of the table, and not a catch-all under a project
 * slug, which is how a top-level page written under the slug reads as
 * "found".
 */
function isRegistered(address: string): boolean {
  const pattern = leafRoutePattern(address);
  return pattern !== null && pattern !== "*" && !pattern.endsWith("/*");
}

/** Every address a path's tour steps navigate to, in step order. */
function tourAddresses(path: (typeof GUIDED_PATHS)[number]): string[] {
  const visited: string[] = [];
  const ctx: TourStepContext = {
    navigate: (to) => {
      visited.push(to);
    },
    actions: {},
  };
  for (const step of TOUR_STEPS[path]) {
    step.before?.(ctx);
    step.onArrive?.(ctx);
  }
  return visited;
}

describe("the addresses the guided onboarding navigates to", () => {
  describe("given the application's route table", () => {
    /** @scenario every address the guided onboarding navigates to is a registered route */
    it("resolves each path's landing and Langy's starting page to a registered route", () => {
      for (const path of GUIDED_PATHS) {
        const landing = guidedLandingRoute({ path, projectSlug: PROJECT_SLUG });
        expect(isRegistered(landing), `${path} landing ${landing}`).toBe(true);
        const start = guidedPathLanding({ path, projectSlug: PROJECT_SLUG });
        expect(isRegistered(start), `${path} start ${start}`).toBe(true);
      }
    });

    /** @scenario every address the guided onboarding navigates to is a registered route */
    it("resolves every tour step's navigation to a registered route", () => {
      for (const path of GUIDED_PATHS) {
        for (const address of tourAddresses(path)) {
          expect(isRegistered(address), `${path} tour ${address}`).toBe(true);
        }
      }
    });

    /** @scenario every address the guided onboarding navigates to is a registered route */
    it("resolves every page name Langy's navigate command opens to a registered route", () => {
      for (const [name, page] of Object.entries(NAVIGATE_PROJECT_PAGES)) {
        const address = `/${PROJECT_SLUG}${page}`;
        expect(isRegistered(address), `${name} ${address}`).toBe(true);
      }
      for (const [name, page] of Object.entries(NAVIGATE_ORGANIZATION_PAGES)) {
        expect(isRegistered(page), `${name} ${page}`).toBe(true);
        // The same page written under the project slug is what the 404 was.
        const underProject = `/${PROJECT_SLUG}${page}`;
        expect(isRegistered(underProject), `${name} ${underProject}`).toBe(
          false,
        );
      }
    });
  });
});
