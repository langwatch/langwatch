/**
 * The seam between a feature package and the shell it mounts in — kept
 * here, not imported from `apps/ui/src/behavior/`, so ui-kernel names no app.
 */

import type {
  UiCapabilityInstall,
  UiRpc,
  UiSessionSource,
} from "@langwatch/browser-host/capabilities";
import type { LazyRouteModule } from "@langwatch/browser-host/navigation";
import type { UiFeatureApiBinding, UiFeatureApiTransport } from "@langwatch/browser-host/transport";
import type { RouteObject } from "react-router";

import type { UiWebRouteParent } from "./ui-web-installation.ts";

/** A page's dynamic import, in the shape `lazyRoute` consumes. */
export type UiPageLoader = () => Promise<LazyRouteModule>;

/** Every page the application can route to, keyed the way the table names it. */
export type UiPageLoaderRegistry = Readonly<Record<string, UiPageLoader>>;

export type UiPageLoaderMerge = {
  /** What the composing application serves from its own source. */
  own: UiPageLoaderRegistry;
  /** What the installed modules serve. */
  host: UiPageLoaderRegistry;
};

/**
 * One registry for the router, own entries first — own wins on a shared
 * key deliberately: during a move both halves register the same key, and
 * host-wins would hide a completed move until someone deleted the old entry.
 */
export function mergeUiPageLoaders({ own, host }: UiPageLoaderMerge): UiPageLoaderRegistry {
  return { ...host, ...own };
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

/** What a failure interceptor may do about the failure it just read. */
export type UiFailureHost = {
  /** Procedures by path, for a remediation the reader can take in one click. */
  readonly rpc: UiRpc;
  /** Moves the address bar, for a remediation that is a page. */
  readonly navigate: (href: string) => void;
};

/**
 * A reader of every failed mutation, installed by the feature that owns one
 * class of failure application-wide. Answers whether it reported the failure,
 * so the shell can tell that nothing else needs to.
 */
export type UiFailureInterceptor = (error: unknown, host: UiFailureHost) => boolean;

/**
 * What the composing application supplies `createUiApplication` beyond its
 * own pages — mirrors `apps/ui/src/behavior/ui-feature.ts`'s `UiFeatureInstall`.
 */
export type UiFeatureInstall = {
  /** The pages the composing application serves from its own source. */
  loaders?: UiPageLoaderRegistry;
  /** One entry per feature package whose hooks this application mounts. */
  apis?: readonly UiFeatureApiBinding[];
  /** Every feature's reader of a failed mutation, in install order. */
  failures?: readonly UiFailureInterceptor[];
  /** Capability ports the composing application answers itself. */
  capabilities?: UiCapabilityInstall;
  /** The transport those hooks run on. Built same-origin when absent. */
  transport?: UiFeatureApiTransport;
  /** The live session this application reads for itself. */
  session?: UiSessionSource;
  routes?: Readonly<Record<UiWebRouteParent, readonly RouteObject[]>>;
};
