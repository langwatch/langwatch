/**
 * Compatibility layer: next/dynamic → React.lazy
 *
 * Next.js `dynamic()` is essentially React.lazy() with optional SSR control
 * and a loading component. Since we no longer have SSR, this is a thin wrapper.
 */
import { lazy, type ComponentType, type ReactNode } from "react";

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
  _options?: DynamicOptions
): ComponentType<P> {
  return lazy(async () => resolveModule(await importFn())) as ComponentType<P>;
}
