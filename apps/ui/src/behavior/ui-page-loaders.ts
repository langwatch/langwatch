/**
 * The seam between the route table and the modules that serve it — the
 * table names a page by key, a loader is registered for it, and neither
 * side knows where the other's file lives.
 */

import type { UiRouteDescriptor } from "../model/ui-route-table";
import type { LazyRouteModule } from "./lazy-route";

/** A page's dynamic import, in the shape `lazyRoute` consumes. */
export type UiPageLoader = () => Promise<LazyRouteModule>;

/** Every page the application can route to, keyed the way the table names it. */
export type UiPageLoaderRegistry = Readonly<Record<string, UiPageLoader>>;

/** Every page key the table names, in table order, without repeats. */
export function uiRoutePageKeys(table: readonly UiRouteDescriptor[]): string[] {
  const keys: string[] = [];

  const visit = (descriptors: readonly UiRouteDescriptor[]): void => {
    for (const descriptor of descriptors) {
      if ("redirect" in descriptor) continue;
      if (!keys.includes(descriptor.page)) keys.push(descriptor.page);
      if (descriptor.children) visit(descriptor.children);
    }
  };

  visit(table);
  return keys;
}

/**
 * A missing key is a composition fault, not a routing one — throws
 * where the router is built, not on the navigation, so the gap surfaces at boot.
 */
export function resolveUiPageLoader({
  registry,
  key,
}: {
  registry: UiPageLoaderRegistry;
  key: string;
}): UiPageLoader {
  const loader = registry[key];
  if (!loader) {
    throw new Error(`No page loader is registered for route page ${JSON.stringify(key)}.`);
  }
  return loader;
}
