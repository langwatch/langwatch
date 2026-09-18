/**
 * Every installed module's api provider, as the shell mounts them. A module
 * that calls `createModuleApi` owns a tRPC react instance whose Provider must
 * be mounted, or its first hook throws "Unable to find tRPC Context".
 */

import type { UiFeatureApiBinding } from "@langwatch/browser-host/transport";

import type { SupplyModule } from "./web-module.ts";

/**
 * Narrowed rather than cast: `installation.api` is `unknown` because the
 * declaration cannot name a module's client type, and a cast here would hide
 * a module declaring the wrong shape until a screen rendered.
 */
function isApiBinding(value: unknown): value is { Provider: UiFeatureApiBinding["Provider"] } {
  // `createTRPCReact()` is a Proxy that reports as a FUNCTION, traps no `has`
  // and owns no keys, so `typeof === "object"` and `"Provider" in value` both
  // say no while `.Provider` is a real component. Ask for the thing we mount.
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  return typeof (value as { Provider?: unknown }).Provider === "function";
}

export function installedModuleApis(
  modules: readonly SupplyModule[],
): readonly UiFeatureApiBinding[] {
  return modules.flatMap((module) => {
    const api = module.installation.api;
    if (api === void 0) return [];
    if (!isApiBinding(api)) {
      throw new Error(
        `Module ${JSON.stringify(module.name)} declared an api with no Provider to mount.`,
      );
    }
    return [{ name: module.name, Provider: api.Provider }];
  });
}
