/**
 * Every declared host mount, composed into one stack the routed tree renders
 * inside. A host implementation reads the route and the capabilities, so this
 * sits below the router and below the feature shell. ARCHITECTURE.md §10.1.
 */

import { loadChunk } from "@langwatch/browser-host/navigation";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

import type { UiModuleHostMount } from "./ui-host-mounts.ts";

/** What a mount's module resolves to: the provider, rendering its children. */
type UiHostProvider = ComponentType<{ children?: ReactNode }>;

/**
 * A chunk that will not load names no module, and this stack is at the ROOT —
 * so the blank page is the whole application, not one screen. A dropped request is
 * retried; one that still fails reaches the page boundary, which offers a retry.
 */
function loadHostProvider(mount: UiModuleHostMount): Promise<{ default: UiHostProvider }> {
  const named = `Module ${JSON.stringify(mount.module)} mounts ${mount.host}`;
  return loadChunk(async () => mount.load()).then(
    (loaded: unknown) => {
      const provider = (loaded as { default?: unknown } | undefined)?.default;
      if (typeof provider !== "function") {
        throw new Error(`${named} with no default-exported provider component.`);
      }
      return { default: provider as UiHostProvider };
    },
    (cause: unknown) => {
      throw new Error(`${named}, and its module did not load.`, { cause });
    },
  );
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
