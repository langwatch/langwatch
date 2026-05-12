/**
 * Compatibility layer: next/dynamic → React.lazy
 *
 * Next.js `dynamic()` is essentially React.lazy() with optional SSR control
 * and a loading component. Since we no longer have SSR, this is a thin wrapper.
 */
import { lazy, Suspense, createElement, forwardRef, type ComponentType, type ReactNode } from "react";

interface DynamicOptions {
  loading?: () => ReactNode;
  ssr?: boolean;
}

/**
 * Resolve a dynamically imported module to a { default: Component } shape
 * that React.lazy expects. Handles ESM, CJS, and double-wrapped modules.
 * @internal Exported for testing only
 */
export function resolveModule(mod: any): { default: ComponentType<any> } {
  const resolved = mod?.default ?? mod;
  // If resolved is a function/class, it's the component
  if (typeof resolved === "function") {
    return { default: resolved };
  }
  // If resolved is an object with a default that's a function (double-wrapped CJS)
  if (
    resolved &&
    typeof resolved === "object" &&
    typeof resolved.default === "function"
  ) {
    return { default: resolved.default };
  }
  // Fallback: return as-is and let React error if it's wrong
  return { default: resolved };
}

export default function dynamic<P extends Record<string, any>>(
  importFn: () => Promise<any>,
  options?: DynamicOptions
): ComponentType<P> {
  const LazyComponent = lazy(async () => resolveModule(await importFn()));
  const fallback = options?.loading ? createElement(options.loading) : null;

  // Wrap in Suspense so the lazy component doesn't bubble up to the root
  // Suspense boundary and flash the entire page gray while loading.
  const DynamicWrapper = forwardRef<any, P>(function DynamicWrapper(props, ref) {
    return createElement(
      Suspense,
      { fallback },
      createElement(LazyComponent as any, { ...props, ref })
    );
  });
  DynamicWrapper.displayName = `Dynamic(${(LazyComponent as any).displayName || "Component"})`;
  return DynamicWrapper as unknown as ComponentType<P>;
}
