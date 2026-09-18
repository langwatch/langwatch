/** Compatibility layer: next/dynamic → React.lazy, since we no longer have SSR. */
import { type ComponentType, createElement, lazy, type ReactNode, Suspense } from "react";

interface DynamicOptions {
  loading?: () => ReactNode;
  ssr?: boolean;
}

function readDefaultExport(value: unknown): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return Object.getOwnPropertyDescriptor(value, "default")?.value;
}

function isComponentType<P extends object>(value: unknown): value is ComponentType<P> {
  return typeof value === "function";
}

function invalidDynamicComponent<P extends object>(): ComponentType<P> {
  return function InvalidDynamicComponent() {
    throw new Error("Dynamic import did not resolve to a React component.");
  };
}

/**
 * Resolve a dynamically imported module to a { default: Component } shape
 * that React.lazy expects. Handles ESM, CJS, and double-wrapped modules.
 * @internal Exported for testing only
 */
export function resolveModule<P extends object>(mod: unknown): { default: ComponentType<P> } {
  const resolved = readDefaultExport(mod) ?? mod;
  // If resolved is a function/class, it's the component
  if (isComponentType<P>(resolved)) {
    return { default: resolved };
  }
  // If resolved is an object with a default that's a function (double-wrapped CJS)
  const doubleWrapped = readDefaultExport(resolved);
  if (isComponentType<P>(doubleWrapped)) {
    return { default: doubleWrapped };
  }
  return { default: invalidDynamicComponent<P>() };
}

export default function dynamic<P extends object>(
  importFn: () => Promise<unknown>,
  options?: DynamicOptions,
): ComponentType<P> {
  const LazyComponent = lazy(async () => resolveModule<P>(await importFn()));
  const fallback = options?.loading ? createElement(options.loading) : null;

  // Wrap in Suspense so the lazy component doesn't bubble up to the root
  // Suspense boundary and flash the entire page gray while loading.
  function DynamicWrapper(props: P) {
    return createElement(Suspense, { fallback }, createElement(LazyComponent, props));
  }
  DynamicWrapper.displayName = "Dynamic(Component)";
  return DynamicWrapper;
}
