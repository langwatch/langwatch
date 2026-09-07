import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { collectWebInstallations } from "../src/behavior/ui-web-installation";
import { uiRoutePageKeys } from "../src/behavior/ui-page-loaders";
import { annotationRoutes } from "../src/features/annotation/ui/sections/annotation-routes";
import { createUiRouteObjects } from "../src/ui/sections/ui-route-objects";
import { uiRouteTable } from "../src/model/ui-route-table";
import type { UiFeatureApiProvider } from "../src/behavior/ui-feature-transport";

function routeLoaders() {
  return Object.fromEntries(
    uiRoutePageKeys(uiRouteTable).map((key) => [key, async () => ({ default: () => null })]),
  );
}

describe("annotation native route installation", () => {
  it("matches all five addresses beneath the marked project layout", () => {
    const routes = createUiRouteObjects({
      table: uiRouteTable,
      loaders: routeLoaders(),
      installedRoutes: { project: annotationRoutes },
    });

    const siblingMatches = matchRoutes(routes, "/project-1/sessions");
    const projectLayout = siblingMatches?.find(
      (match) => match.route.handle?.page === "features/langy/ProjectLangyLayout",
    )?.route;
    expect(projectLayout).toBeDefined();

    for (const [pathname, page] of [
      ["/project-1/annotations", "pages/[project]/annotations"],
      ["/project-1/annotations/all", "pages/[project]/annotations/all"],
      ["/project-1/annotations/me", "pages/[project]/annotations/me"],
      ["/project-1/annotations/my-queue", "pages/[project]/annotations/my-queue"],
      ["/project-1/annotations/review-queue", "pages/[project]/annotations/[slug]"],
    ]) {
      const matches = matchRoutes(routes, pathname);
      expect(matches?.at(-1)?.route.handle?.page).toBe(page);
      expect(matches?.find((match) => match.route === projectLayout)?.route).toBe(projectLayout);
      expect(matches?.at(-1)?.params.project).toBe("project-1");
    }
  });

  it("refuses a missing or duplicated project mount anchor", () => {
    const loaders = { layout: async () => ({ default: () => null }) };
    const installedRoutes = { project: annotationRoutes };

    expect(() =>
      createUiRouteObjects({ table: [{ page: "layout" }], loaders, installedRoutes }),
    ).toThrow('Web installation route parent "project" must have exactly one anchor.');

    expect(() =>
      createUiRouteObjects({
        table: [
          { page: "one", webRouteParent: "project" },
          { page: "two", webRouteParent: "project" },
        ],
        loaders: {
          one: async () => ({ default: () => null }),
          two: async () => ({ default: () => null }),
        },
        installedRoutes,
      }),
    ).toThrow('Web installation route parent "project" must have exactly one anchor.');
  });

  it("rejects API names that collide with legacy registrations", () => {
    const Provider: UiFeatureApiProvider = () => null;
    expect(() =>
      collectWebInstallations({
        installations: [
          { name: "legacy", api: { name: "annotation", Provider }, loaders: {}, drawers: {} },
          {
            name: "annotation",
            install(ui) {
              ui.api({ name: "annotation", Provider });
            },
          },
        ],
      }),
    ).toThrow("API provider annotation is installed twice");
  });
});
