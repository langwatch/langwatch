/**
 * What an installed browser module contributes to the drawer host: one lazy
 * component per drawer it declares, under the name the address bar carries.
 * The host mounts one of them at a time, so the whole browser has one registry.
 */

import type { UiDrawerComponent, UiDrawerRegistry } from "@langwatch/browser-host/drawer";
import { installedDrawerLoaders, type SupplyModule } from "@langwatch/ui-kernel";
import { lazy } from "react";

/** The composed registry `CurrentDrawer` resolves an open address against. */
export function installedModuleDrawers(modules: readonly SupplyModule[]): UiDrawerRegistry {
  const registry: Record<string, UiDrawerComponent> = {};

  for (const [drawer, load] of Object.entries(installedDrawerLoaders(modules))) {
    registry[drawer] = drawerComponent({ drawer, load });
  }

  return registry;
}

/**
 * Stays lazy: a drawer's chunk carries editors and viewers no page needs
 * until the address opens one.
 */
function drawerComponent({
  drawer,
  load,
}: {
  drawer: string;
  load: () => Promise<unknown>;
}): UiDrawerComponent {
  const component = lazy(async () => {
    const loaded = await load();
    if (!isDrawerModule(loaded)) {
      throw new Error(`Drawer ${JSON.stringify(drawer)} did not load a component.`);
    }
    return loaded;
  });
  Object.defineProperty(component, "name", { value: drawer });
  return component;
}

function isDrawerModule(value: unknown): value is { default: UiDrawerComponent } {
  if (typeof value !== "object" || value === null) return false;
  return "default" in value && typeof value.default === "function";
}
