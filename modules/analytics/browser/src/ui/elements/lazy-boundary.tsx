/**
 * A lazily loaded component with a loading state of its own, narrowed
 * from `platform/app`'s `next-dynamic` shim. The Suspense boundary sits
 * INSIDE on purpose: outside, a pending import blanks the whole page.
 */

import {
  createElement,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";

export function lazyBoundary<P extends object>(
  Loaded: LazyExoticComponent<ComponentType<P>>,
  loading: () => ReactNode,
): ComponentType<P> {
  const Boundary = (props: P) =>
    createElement(Suspense, { fallback: createElement(loading) }, createElement(Loaded, props));
  Boundary.displayName = "LazyBoundary";
  return Boundary;
}
