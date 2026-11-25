/**
 * Every installed module's drawers, as one registry of loaders keyed by the
 * name the address bar carries. The browser mounts one drawer at a time, so
 * one name has one owner.
 */

import type { SupplyModule } from "./web-module.ts";

/** What the shell turns into components: drawer name -> its chunk. */
export type InstalledDrawerLoaders = Readonly<Record<string, () => Promise<unknown>>>;

/**
 * Two modules claiming one drawer name is a composition fault, and it throws
 * here — where the browser is composed — rather than on the address that
 * opens it, where the loser would simply never appear.
 */
export function installedDrawerLoaders(modules: readonly SupplyModule[]): InstalledDrawerLoaders {
  const loaders: Record<string, () => Promise<unknown>> = {};
  const owners: Record<string, string> = {};

  for (const module of modules) {
    for (const [drawer, declared] of Object.entries(module.installation.drawers)) {
      const owner = owners[drawer];
      if (owner !== void 0) {
        throw new Error(
          `Drawer ${JSON.stringify(drawer)} is declared by both "${owner}" and "${module.name}".`,
        );
      }
      owners[drawer] = module.name;
      loaders[drawer] = declared.load;
    }
  }

  return loaders;
}
