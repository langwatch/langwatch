/**
 * The application's router: the root stanza every route hangs from, and the
 * browser router built around it.
 *
 * The routes arrive already materialised — turning descriptors into route
 * objects composes an element, so it belongs to `ui/sections` — and the root
 * layout and error boundary arrive as components. What is left here is the
 * shape of the tree itself, which is behaviour over the router library.
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
 * React Router expects a HydrateFallback when the root route is async; the
 * application uses lazy() per route and never blocks hydration, but React
 * Router still warns if no fallback is declared. Rendering nothing is correct
 * here — the root layout and its Suspense already render the right shell once
 * children resolve, and showing nothing for the few ms before that is the
 * existing behaviour.
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
