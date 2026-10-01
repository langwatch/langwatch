/**
 * Turns the route table into React Router route objects.
 */

import { lazyRoute } from "@langwatch/browser-host/navigation";
import { Outlet, useMatches, type RouteObject } from "react-router";

import {
  resolveUiPageLoader,
  type UiPageLoader,
  type UiPageLoaderRegistry,
} from "./ui-feature-install.ts";
import { UiPrefixRedirect } from "./ui-prefix-redirect.tsx";
import {
  uiRouteDescriptors,
  type UiRouteDescriptor,
  type UiShellLayout,
} from "./ui-route-descriptor.ts";
import type { UiWebRouteParent } from "./ui-web-installation.ts";

/** What a materialised page route carries on its match. */
export type UiRouteHandle = { page: string };

/** The page key of the deepest matched route, when it carries one. */
export function uiMatchedPageKey(matches: readonly { handle?: unknown }[]): string | undefined {
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
  installedRoutes?: Readonly<Record<UiWebRouteParent, readonly RouteObject[]>>;
  /**
   * The layouts the shell draws itself — composition's to supply, since a
   * second browser app frames a different set of installed modules.
   */
  shellLayouts?: Readonly<Record<UiShellLayout, UiPageLoader>>;
};

export function createUiRouteObjects({
  table,
  loaders,
  installedRoutes,
  shellLayouts = {},
}: UiRouteObjectsOptions): RouteObject[] {
  const hasProjectContributions = (installedRoutes?.project.length ?? 0) > 0;
  if (hasProjectContributions) {
    const anchors = uiRouteDescriptors(table).filter(
      (descriptor) => "webRouteParent" in descriptor && descriptor.webRouteParent === "project",
    );
    if (anchors.length !== 1) {
      throw new Error('Web installation route parent "project" must have exactly one anchor.');
    }
  }

  return materializeRoutes({ table, loaders, installedRoutes, shellLayouts });
}

/**
 * A missing layout is a composition fault — throws where the router is
 * built, exactly as `resolveUiPageLoader` does for a missing page key.
 */
function resolveUiShellLayoutLoader({
  shellLayouts,
  layout,
}: {
  shellLayouts: Readonly<Record<UiShellLayout, UiPageLoader>>;
  layout: UiShellLayout;
}): UiPageLoader {
  const loader = shellLayouts[layout];
  if (!loader) {
    throw new Error(`No shell layout is registered for ${JSON.stringify(layout)}.`);
  }
  return loader;
}

type MaterializeRoutesOptions = Omit<UiRouteObjectsOptions, "shellLayouts"> & {
  shellLayouts: Readonly<Record<UiShellLayout, UiPageLoader>>;
};

function materializeRoutes({
  table,
  loaders,
  installedRoutes,
  shellLayouts,
}: MaterializeRoutesOptions): RouteObject[] {
  const routes = table.map((descriptor) => {
    if ("redirect" in descriptor) {
      const { from, to, pinParams, renameParams, mapSegment } = descriptor.redirect;
      return {
        path: descriptor.path,
        element: (
          <UiPrefixRedirect
            from={from}
            to={to}
            pinParams={pinParams}
            renameParams={renameParams}
            mapSegment={mapSegment}
          />
        ),
      };
    }

    const route: RouteObject =
      "layout" in descriptor
        ? { ...lazyRoute(resolveUiShellLayoutLoader({ shellLayouts, layout: descriptor.layout })) }
        : {
            ...lazyRoute(resolveUiPageLoader({ registry: loaders, key: descriptor.page })),
            // The key travels onto the match, so a LAYOUT route above the page can ask
            // which half of the product serves it.
            handle: { page: descriptor.page } satisfies UiRouteHandle,
          };
    if ("path" in descriptor && descriptor.path !== void 0) route.path = descriptor.path;
    const children = descriptor.children
      ? materializeRoutes({
          table: descriptor.children,
          loaders,
          installedRoutes,
          shellLayouts,
        })
      : [];
    if ("webRouteParent" in descriptor && descriptor.webRouteParent === "project") {
      children.push(...(installedRoutes?.project ?? []));
    }
    if (children.length > 0) {
      route.children = children;
    }
    return route;
  });
  return routes;
}
