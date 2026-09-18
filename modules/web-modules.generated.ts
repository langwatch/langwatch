/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

/** No module declares a web half yet. */
export const webModules = [] as const;
import type { serverModules } from "./server-modules.generated";
export const webModulePackages = {} as const;
type PairedOnDisk = never;
type MissingWeb = Exclude<PairedOnDisk, (typeof webModules)[number]["id"]>;
type MissingServer = Exclude<PairedOnDisk, (typeof serverModules)[number]["name"]>;
export const webModulePairing = {} satisfies {
  [Id in `missing web half "${MissingWeb}"` | `missing server half "${MissingServer}"`]: never;
};
