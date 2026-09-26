/**
 * The browser application, composed once.
 */

import type { UiDrawerRegistry } from "@langwatch/browser-host/drawer";
import { createUiRouter, type UiRouter } from "@langwatch/browser-host/navigation";
import type { ComponentType } from "react";
import type { FallbackProps } from "react-error-boundary";

import {
  mergeUiPageLoaders,
  type UiFeatureInstall,
  type UiPageLoader,
  type UiPageLoaderRegistry,
} from "./ui-feature-install.ts";
import { createUiFeatureShell } from "./ui-feature-shell.tsx";
import { createUiInnerProvider, type UiInnerProviderInstall } from "./ui-inner-providers.tsx";
import { createUiModuleHostStack } from "./ui-module-hosts.tsx";
import {
  createUiOuterProvider,
  type UiOuterProviderInstall,
  type UiProviderShell,
} from "./ui-outer-providers.tsx";
import { createUiRootLayout } from "./ui-root-layout.tsx";
import type { UiRouteDescriptor, UiShellLayout } from "./ui-route-descriptor.ts";
import { createUiRouteObjects } from "./ui-route-objects.tsx";

export type UiApplicationInstall = {
  providers: UiOuterProviderInstall & UiInnerProviderInstall;
  pages: {
    /** The application's URL surface, as data — composition's own route table. */
    table: readonly UiRouteDescriptor[];
    /** A loader for every page key the route table names. */
    loaders: UiPageLoaderRegistry;
    /** The layouts the shell draws itself. See `UiRouteObjectsOptions`. */
    shellLayouts?: Readonly<Record<UiShellLayout, UiPageLoader>>;
    /** Rendered when a page throws below the root layout. */
    errorFallback: ComponentType<FallbackProps>;
    /** Catches render and loader throws anywhere below the root route. */
    rootErrorBoundary: ComponentType;
  };
  /** What this package contributes. Defaults to its standing declaration. */
  features?: UiFeatureInstall;
  /** Composed by installedModuleDrawers(installed.modules). */
  drawers?: UiDrawerRegistry;
  /**
   * The query key the composing application's session read is cached
   * under. See `UiFeatureShellInstall.sessionQueryKey`.
   */
  sessionQueryKey: readonly unknown[];
};

export type UiApplication = {
  outerProvider: UiProviderShell;
  router: UiRouter;
};

export function createUiApplication({
  providers,
  pages,
  drawers = {},
  features = {},
  sessionQueryKey,
}: UiApplicationInstall): UiApplication {
  const loaders = mergeUiPageLoaders({
    own: features.loaders ?? {},
    host: pages.loaders,
  });

  return {
    outerProvider: createUiOuterProvider(providers),
    router: createUiRouter({
      routes: createUiRouteObjects({
        table: pages.table,
        loaders,
        installedRoutes: features.routes,
        shellLayouts: pages.shellLayouts,
      }),
      rootComponent: createUiRootLayout({
        innerProvider: createUiInnerProvider(providers),
        featureShell: createUiFeatureShell({
          apis: features.apis ?? [],
          capabilities: features.capabilities ?? {},
          drawers,
          moduleHosts: createUiModuleHostStack(features.hosts ?? []),
          failures: features.failures ?? [],
          isDevelopment: providers.isDevelopment,
          sessionQueryKey,
          ...(features.transport ? { transport: features.transport } : {}),
          ...(features.session ? { session: features.session } : {}),
        }),
        pageErrorFallback: pages.errorFallback,
      }),
      rootErrorBoundary: pages.rootErrorBoundary,
    }),
  };
}
