/**
 * The browser application, composed once.
 *
 * Provider order, the root layout, the route table and the router are this
 * package's structure. The composing application hands over only what it still
 * owns — the providers it implements, the loader for each page key, and the
 * two error components — and gets back the outer provider and router the
 * application shell renders.
 */

import type { ComponentType } from "react";
import type { FallbackProps } from "react-error-boundary";
import { createUiRouter, type UiRouter } from "../../behavior/ui-router";
import type { UiPageLoaderRegistry } from "../../behavior/ui-page-loaders";
import { uiRouteTable } from "../../model/ui-route-table";
import { createUiInnerProvider, type UiInnerProviderInstall } from "./ui-inner-providers";
import {
  createUiOuterProvider,
  type UiOuterProviderInstall,
  type UiProviderShell,
} from "./ui-outer-providers";
import { createUiRouteObjects } from "./ui-route-objects";
import { createUiRootLayout } from "./ui-root-layout";

export type UiApplicationInstall = {
  providers: UiOuterProviderInstall & UiInnerProviderInstall;
  pages: {
    /** A loader for every page key the route table names. */
    loaders: UiPageLoaderRegistry;
    /** Rendered when a page throws below the root layout. */
    errorFallback: ComponentType<FallbackProps>;
    /** Catches render and loader throws anywhere below the root route. */
    rootErrorBoundary: ComponentType;
  };
};

export type UiApplication = {
  outerProvider: UiProviderShell;
  router: UiRouter;
};

export function createUiApplication({ providers, pages }: UiApplicationInstall): UiApplication {
  return {
    outerProvider: createUiOuterProvider(providers),
    router: createUiRouter({
      routes: createUiRouteObjects({ table: uiRouteTable, loaders: pages.loaders }),
      rootComponent: createUiRootLayout({
        innerProvider: createUiInnerProvider(providers),
        pageErrorFallback: pages.errorFallback,
      }),
      rootErrorBoundary: pages.rootErrorBoundary,
    }),
  };
}
