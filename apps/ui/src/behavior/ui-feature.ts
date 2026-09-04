/**
 * One install surface per feature. A feature directory exports exactly one
 * `<x>Feature = uiFeature({...})` value; `installUiFeatures` composes the
 * whole list into what `createUiApplication` mounts.
 *
 * Design: dev/docs/plans/ui-install-surface-2026-09-05.md.
 */

import type { ComponentType, ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { UiDrawerRegistry } from "@langwatch/ui-drawer";
import type { UiCapabilityInstall } from "./ui-capabilities";
import type {
  UiFeatureApiBinding,
  UiFeatureApiProvider,
  UiFeatureApiTransport,
} from "./ui-feature-transport";
import type { UiPageLoaderRegistry } from "./ui-page-loaders";
import type { UiSessionSource } from "./ui-session";
import type { UiFeatureInstall } from "../ui/sections/ui-application";

/** One feature package's whole contribution to the browser application. */
export type UiFeature = {
  readonly name: string;
  readonly api?: UiFeatureApiBinding;
  readonly loaders: UiPageLoaderRegistry;
  readonly drawers: UiDrawerRegistry;
};

/**
 * Builds a feature's install value. Erases the client Provider type the same
 * way `uiFeatureApi` used to — the one place allowed to erase either client
 * shape — and defaults `loaders`/`drawers` to `{}` rather than leaving them
 * undefined, so a feature with none still composes like every other one.
 */
export function uiFeature<TClient, const D extends UiDrawerRegistry = Record<string, never>>({
  name,
  api,
  loaders = {},
  drawers,
}: {
  name: string;
  api?: {
    Provider: ComponentType<{ client: TClient; queryClient: QueryClient; children: ReactNode }>;
  };
  loaders?: UiPageLoaderRegistry;
  drawers?: D;
}): UiFeature & { readonly drawers: D } {
  return {
    name,
    ...(api ? { api: { name, Provider: api.Provider as UiFeatureApiProvider } } : {}),
    loaders,
    drawers: (drawers ?? {}) as D,
  };
}

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

export type UiFeatureInstallResult<F extends readonly UiFeature[]> = UiFeatureInstall & {
  readonly drawers: UnionToIntersection<F[number]["drawers"]>;
};

/**
 * Merges a feature list into one install. A page key or drawer name served
 * by two features is a programming fault, not a runtime condition either
 * feature's caller can act on, so it throws a plain `Error` naming both
 * features rather than letting the later one win silently.
 */
export function installUiFeatures<const F extends readonly UiFeature[]>({
  features,
  capabilities,
  session,
  transport,
}: {
  features: F;
  capabilities?: UiCapabilityInstall;
  session?: UiSessionSource;
  transport?: UiFeatureApiTransport;
}): UiFeatureInstallResult<F> {
  const loaders = mergeUniquely({
    features,
    pick: (feature) => feature.loaders,
    describe: (key) => `Page key "${key}"`,
  }) as UiPageLoaderRegistry;
  const drawers = mergeUniquely({
    features,
    pick: (feature) => feature.drawers,
    describe: (key) => `Drawer "${key}"`,
  }) as UnionToIntersection<F[number]["drawers"]>;

  const install: UiFeatureInstall = {
    loaders,
    apis: features.flatMap((feature) => (feature.api ? [feature.api] : [])),
    capabilities: capabilities ?? {},
    ...(transport ? { transport } : {}),
    ...(session ? { session } : {}),
  };

  return { ...install, drawers };
}

function mergeUniquely<F extends readonly UiFeature[]>({
  features,
  pick,
  describe,
}: {
  features: F;
  pick: (feature: UiFeature) => Readonly<Record<string, unknown>>;
  describe: (key: string) => string;
}): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const owners: Record<string, string> = {};

  for (const feature of features) {
    for (const [key, value] of Object.entries(pick(feature))) {
      const owner = owners[key];
      if (owner !== undefined) {
        throw new Error(`${describe(key)} is served by both "${owner}" and "${feature.name}"`);
      }
      owners[key] = feature.name;
      merged[key] = value;
    }
  }

  return merged;
}
