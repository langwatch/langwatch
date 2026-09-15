/**
 * A lazily loaded component with a loading state of its own.
 *
 * `platform/app`'s `~/utils/compat/next-dynamic`, narrowed to the one shape
 * this package uses. What was dropped is the `ssr` flag, which this deployment
 * has had nothing to say to since the app stopped rendering on the server, and
 * the CJS double-wrap unwinding, which only mattered for modules published as
 * CommonJS — every module lazily loaded here is this package's own.
 *
 * The Suspense boundary is INSIDE the wrapper on purpose: without it the
 * pending import bubbles to the application's root boundary and the whole page
 * flashes empty while a chart library downloads.
 */

import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from "react";

export function lazyBoundary<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  loading: () => ReactNode,
): ComponentType<P> {
  const Loaded = lazy(load);
  const Boundary = (props: P) =>
    createElement(Suspense, { fallback: createElement(loading) }, createElement(Loaded, props));
  Boundary.displayName = "LazyBoundary";
  return Boundary;
}
