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

export default function dynamic<P extends Record<string, any>>(
  importFn: () => Promise<any>,
  _options?: DynamicOptions
): ComponentType<P> {
  return lazy(async () => {
    const mod = await importFn();
    // Vite wraps CJS modules as { default: moduleExports }.
    // The actual component could be:
    //   1. mod.default (ES module default export — already a function/class)
    //   2. mod.default.default (CJS module.exports wrapped by Vite, then re-wrapped)
    //   3. mod itself (direct function export)
    const resolved = mod?.default ?? mod;
    // If resolved is a function/class, it's the component
    if (typeof resolved === "function") {
      return { default: resolved };
    }
    // If resolved is an object with a default that's a function (double-wrapped CJS)
    if (resolved && typeof resolved === "object" && typeof resolved.default === "function") {
      return { default: resolved.default };
    }
    // Fallback: return as-is and let React error if it's wrong
    return { default: resolved };
  }) as ComponentType<P>;
}
