/**
 * Turns the route table into React Router route objects.
 */

import { Outlet, useMatches, type RouteObject } from "react-router";
import { lazyRoute } from "../../behavior/lazy-route";
import { resolveUiPageLoader, type UiPageLoaderRegistry } from "../../behavior/ui-page-loaders";
import type { UiRouteDescriptor } from "../../model/ui-route-table";
import { UiPrefixRedirect } from "../elements/ui-prefix-redirect";

/** What a materialised page route carries on its match. */
export type UiRouteHandle = { page: string };

/** The page key of the deepest matched route, when it carries one. */
export function uiMatchedPageKey(matches: ReadonlyArray<{ handle?: unknown }>): string | undefined {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle as UiRouteHandle | undefined;
    if (handle?.page) return handle.page;
  }
  return void 0;
}

/** The page key of the route this render is inside. */
export function useUiMatchedPageKey(): string | undefined {
  return uiMatchedPageKey(useMatches());
}

/**
 * Where a layout route draws the page below it. The shell owns the router, so
 * a feature layout asks for the outlet rather than reaching for one.
 */
export function UiRouteOutlet() {
  return <Outlet />;
}

export type UiRouteObjectsOptions = {
  table: readonly UiRouteDescriptor[];
  loaders: UiPageLoaderRegistry;
};

export function createUiRouteObjects({ table, loaders }: UiRouteObjectsOptions): RouteObject[] {
  return table.map((descriptor) => {
    if ("redirect" in descriptor) {
      const { from, to, pinParams, mapSegment } = descriptor.redirect;
      return {
        path: descriptor.path,
        element: (
          <UiPrefixRedirect from={from} to={to} pinParams={pinParams} mapSegment={mapSegment} />
        ),
      };
    }

    const route: RouteObject = {
      ...lazyRoute(resolveUiPageLoader({ registry: loaders, key: descriptor.page })),
      // The key travels onto the match, so a LAYOUT route above the page can ask which
      // half of the product serves it.
      handle: { page: descriptor.page } satisfies UiRouteHandle,
    };
    if (descriptor.path !== void 0) route.path = descriptor.path;
    if (descriptor.children) {
      route.children = createUiRouteObjects({ table: descriptor.children, loaders });
    }
    return route;
  });
}
