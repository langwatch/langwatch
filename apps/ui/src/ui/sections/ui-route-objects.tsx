/**
 * Turns the route table into React Router route objects.
 *
 * A page descriptor becomes a lazily loaded route through the registered
 * loader for its key; a redirect descriptor becomes a rendered
 * `UiPrefixRedirect`, which is why this materialisation is presentation and
 * not behaviour.
 */

import type { RouteObject } from "react-router";
import { lazyRoute } from "../../behavior/lazy-route";
import { resolveUiPageLoader, type UiPageLoaderRegistry } from "../../behavior/ui-page-loaders";
import type { UiRouteDescriptor } from "../../model/ui-route-table";
import { UiPrefixRedirect } from "../elements/ui-prefix-redirect";

export type UiRouteObjectsOptions = {
  table: readonly UiRouteDescriptor[];
  loaders: UiPageLoaderRegistry;
};

export function createUiRouteObjects({ table, loaders }: UiRouteObjectsOptions): RouteObject[] {
  return table.map((descriptor) => {
    if ("redirect" in descriptor) {
      const { from, to, pinParams } = descriptor.redirect;
      return {
        path: descriptor.path,
        element: <UiPrefixRedirect from={from} to={to} pinParams={pinParams} />,
      };
    }

    const route: RouteObject = {
      ...lazyRoute(resolveUiPageLoader({ registry: loaders, key: descriptor.page })),
    };
    if (descriptor.path !== void 0) route.path = descriptor.path;
    if (descriptor.children) {
      route.children = createUiRouteObjects({ table: descriptor.children, loaders });
    }
    return route;
  });
}
