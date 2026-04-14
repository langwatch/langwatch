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
    // Support both { default: Component } and direct function exports
    if (mod && typeof mod === "object" && "default" in mod) {
      return mod;
    }
    // If the module itself is the component
    return { default: mod };
  }) as ComponentType<P>;
}
