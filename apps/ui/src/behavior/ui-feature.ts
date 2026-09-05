/**
 * One install surface per feature. A feature directory exports exactly one `<x>Feature
 * = uiFeature({...})` value; `installUiFeatures` composes the whole list into what
 * `createUiApplication` mounts.
 */

import type { ComponentType, ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { UiDrawerRegistry } from "@langwatch/ui-drawer";
import type { UiCapabilityInstall } from "@langwatch/ui-host/capabilities";
import type {
  UiFeatureApiBinding,
  UiFeatureApiProvider,
  UiFeatureApiTransport,
} from "./ui-feature-transport";
import type { UiPageLoaderRegistry } from "./ui-page-loaders";
import type { UiSessionSource } from "./ui-session";

/**
 * What `apps/ui` serves itself.
 */
export type UiFeatureInstall = {
  /**
   * The pages this package serves, consulted before the host's registry.
   * Replaces `uiFeatureLoaders` rather than adding to it — one rule, so a
   * test's registry is the whole answer and never a partial one.
   */
  loaders?: UiPageLoaderRegistry;
  /** One entry per feature package whose hooks this application mounts. */
  apis?: readonly UiFeatureApiBinding[];
  /** Capability ports the composing application answers itself. */
  capabilities?: UiCapabilityInstall;
  /** The transport those hooks run on. Built same-origin when absent. */
  transport?: UiFeatureApiTransport;
  /**
   * The live session this application reads for itself — pass `useBrowserUiSession` to
   * serve the reader, the scope and the permissions from the deployment.
   */
  session?: UiSessionSource;
};

/** One feature package's whole contribution to the browser application. */
export type UiFeature = {
  readonly name: string;
  readonly api?: UiFeatureApiBinding;
  readonly loaders: UiPageLoaderRegistry;
  readonly drawers: UiDrawerRegistry;
};

/**
 * Builds a feature's install value.
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
 * Merges a feature list into one install.
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
