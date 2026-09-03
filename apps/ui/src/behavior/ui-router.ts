/**
 * The application's router: the root stanza every route hangs from.
 * Routes arrive already materialised (composing an element belongs to
 * `ui/sections`); what's left here is the shape of the tree itself.
 */

import type { ComponentType } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";

export type UiRouter = ReturnType<typeof createBrowserRouter>;

export type UiRouterOptions = {
  /** The application's routes, in match order. */
  routes: readonly RouteObject[];
  /** Wraps every route: router-context providers, navigation progress, Suspense. */
  rootComponent: ComponentType;
  /** Catches render and loader throws anywhere below the root. */
  rootErrorBoundary: ComponentType;
};

/**
 * React Router warns with no HydrateFallback, even though this app's
 * lazy() routes never block hydration. Nothing is correct: the root
 * layout's own Suspense already renders the right shell once children resolve.
 */
function HydrateFallback(): null {
  return null;
}

export function createUiRouter({
  routes,
  rootComponent,
  rootErrorBoundary,
}: UiRouterOptions): UiRouter {
  return createBrowserRouter([
    {
      Component: rootComponent,
      HydrateFallback,
      ErrorBoundary: rootErrorBoundary,
      children: [...routes],
    },
  ]);
}
