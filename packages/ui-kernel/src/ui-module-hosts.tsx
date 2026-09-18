/**
 * Every declared host mount, composed into one stack the routed tree renders
 * inside. A host implementation reads the route and the capabilities, so this
 * sits below the router and below the feature shell. ARCHITECTURE.md §10.1.
 */

import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

import type { UiModuleHostMount } from "./ui-host-mounts.ts";

/** What a mount's module resolves to: the provider, rendering its children. */
type UiHostProvider = ComponentType<{ children?: ReactNode }>;

function loadHostProvider(mount: UiModuleHostMount): Promise<{ default: UiHostProvider }> {
  return Promise.resolve(mount.load()).then((loaded) => {
    const provider = (loaded as { default?: unknown }).default;
    if (typeof provider !== "function") {
      throw new Error(
        `Module ${JSON.stringify(mount.module)} mounts ${mount.host} with no default-exported provider component.`,
      );
    }
    return { default: provider as UiHostProvider };
  });
}

/**
 * `lazy` is called once per mount HERE, at composition time — calling it in a
 * render would make a new component type every pass and remount the whole tree
 * under it on every render.
 */
export function createUiModuleHostStack(
  mounts: readonly UiModuleHostMount[],
): ComponentType<{ children?: ReactNode }> {
  const providers = mounts.map((mount) => lazy(() => loadHostProvider(mount)));

  return function UiModuleHosts({ children }: { children?: ReactNode }) {
    // Innermost first, so the list reads in mount order at the declaration.
    const mounted = providers.reduceRight<ReactNode>(
      (inner, Provider) => <Provider>{inner}</Provider>,
      children,
    );
    return <Suspense>{mounted}</Suspense>;
  };
}
