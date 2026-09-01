/**
 * The browser application, composed once.
 *
 * Provider order, the root layout, the route table and the router are this
 * package's structure. The composing application hands over only what it still
 * owns — the providers it implements, the loader for each page key, and the
 * two error components — and gets back the outer provider and router the
 * application shell renders.
 *
 * `features` is the other half: what this package serves itself. A screen that
 * has moved declares its loader, the feature-api Providers its hooks need and
 * the capability ports it fills, all three in one place, and the host is not
 * edited at all.
 */

import type { ComponentType } from "react";
import type { FallbackProps } from "react-error-boundary";
import type { UiCapabilityInstall } from "../../behavior/ui-capabilities";
import { mergeUiPageLoaders, uiFeatureLoaders } from "../../behavior/ui-feature-loaders";
import type {
  UiFeatureApiBinding,
  UiFeatureApiTransport,
} from "../../behavior/ui-feature-transport";
import type { UiPageLoaderRegistry } from "../../behavior/ui-page-loaders";
import { createUiRouter, type UiRouter } from "../../behavior/ui-router";
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

/**
 * What `apps/ui` serves itself.
 *
 * Every field is optional and every default is this package's own standing
 * declaration, so a host that knows nothing about any of it composes exactly
 * as it did before.
 */
export type UiFeatureInstall = {
  /**
   * The pages this package serves, consulted before the host's registry.
   * Replaces `uiFeatureLoaders` rather than adding to it — one rule, so a
   * test's registry is the whole answer and never a partial one.
   */
  loaders?: UiPageLoaderRegistry;
  /** One entry per feature package whose hooks this application mounts. */
  apis?: readonly UiFeatureApiBinding[];
  /** Capability ports the composing application answers itself. */
  capabilities?: UiCapabilityInstall;
  /** The transport those hooks run on. Built same-origin when absent. */
  transport?: UiFeatureApiTransport;
};

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
        }),
        pageErrorFallback: pages.errorFallback,
      }),
      rootErrorBoundary: pages.rootErrorBoundary,
    }),
  };
}
