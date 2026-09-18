/**
 * What an installed web module contributes to the router: a loader for every
 * screen it declares, and a route for every screen it places itself. The
 * route table still names the paths it owns; a module owns its own.
 */

import type { SupplyModule, WebScreen } from "@langwatch/ui-kernel";
import type { RouteObject } from "react-router";

import { lazyRoute, type LazyRouteModule } from "./lazy-route";
import type { UiPageLoader, UiPageLoaderRegistry } from "./ui-page-loaders";
import type { UiWebRouteParent } from "./ui-web-installation";

export type UiModuleScreens = {
  loaders: UiPageLoaderRegistry;
  routes: Readonly<Record<UiWebRouteParent, readonly RouteObject[]>>;
};

/**
 * Every installed module's screens, as one registry and one route list. Two
 * modules claiming one page key is a composition fault and throws here, where
 * the router is built, rather than on the navigation that reaches it.
 */
export function installedModuleScreens(modules: readonly SupplyModule[]): UiModuleScreens {
  const loaders: Record<string, UiPageLoader> = {};
  const owners: Record<string, string> = {};
  const project: RouteObject[] = [];

  for (const module of modules) {
    for (const [page, screen] of Object.entries(module.installation.screens)) {
      const load = screenLoader({ page, screen });
      if (!load) continue;
      const owner = owners[page];
      if (owner !== void 0) {
        throw new Error(`Page ${JSON.stringify(page)} is declared by both "${owner}" and "${module.name}".`);
      }
      owners[page] = module.name;
      loaders[page] = load;
      if (screen.within === "project" && screen.path !== void 0) {
        project.push({ path: screen.path, ...lazyRoute(load), handle: { page } });
      }
    }
  }

  return { loaders, routes: { project } };
}

/** A declared screen answers with a component, or the composition is wrong. */
function screenLoader({
  page,
  screen,
}: {
  page: string;
  screen: WebScreen;
}): UiPageLoader | undefined {
  const load = screen.load;
  if (!load) return void 0;
  return async () => {
    const loaded = await load();
    if (!isLazyRouteModule(loaded)) {
      throw new Error(`Screen ${JSON.stringify(page)} did not load a component.`);
    }
    return loaded;
  };
}

function isLazyRouteModule(value: unknown): value is LazyRouteModule {
  if (typeof value !== "object" || value === null) return false;
  return "default" in value && typeof value.default === "function";
}
