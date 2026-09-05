/**
 * The browser application, composed once.
 */

import type { ComponentType } from "react";
import type { FallbackProps } from "react-error-boundary";
import type { UiCapabilityInstall } from "@langwatch/ui-host/capabilities";
import { mergeUiPageLoaders, uiFeatureLoaders } from "../../behavior/ui-feature-loaders";
import type {
  UiFeatureApiBinding,
  UiFeatureApiTransport,
} from "../../behavior/ui-feature-transport";
import type { UiFeatureInstall } from "../../behavior/ui-feature";
import type { UiPageLoaderRegistry } from "../../behavior/ui-page-loaders";
import { createUiRouter, type UiRouter } from "../../behavior/ui-router";
import type { UiSessionSource } from "../../behavior/ui-session";
import { uiRouteTable } from "../../model/ui-route-table";
import { createUiFeatureShell } from "./ui-feature-shell";
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
  /** What this package contributes. Defaults to its standing declaration. */
  features?: UiFeatureInstall;
};

export type UiApplication = {
  outerProvider: UiProviderShell;
  router: UiRouter;
};

export function createUiApplication({
  providers,
  pages,
  features = {},
}: UiApplicationInstall): UiApplication {
  const loaders = mergeUiPageLoaders({
    own: features.loaders ?? uiFeatureLoaders,
    host: pages.loaders,
  });

  return {
    outerProvider: createUiOuterProvider(providers),
    router: createUiRouter({
      routes: createUiRouteObjects({ table: uiRouteTable, loaders }),
      rootComponent: createUiRootLayout({
        innerProvider: createUiInnerProvider(providers),
        featureShell: createUiFeatureShell({
          apis: features.apis ?? [],
          capabilities: features.capabilities ?? {},
          ...(features.transport ? { transport: features.transport } : {}),
          ...(features.session ? { session: features.session } : {}),
        }),
        pageErrorFallback: pages.errorFallback,
      }),
      rootErrorBoundary: pages.rootErrorBoundary,
    }),
  };
}
