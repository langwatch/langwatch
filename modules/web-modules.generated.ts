/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

import { annotationWeb } from "@langwatch/annotation-browser/declaration";

/** Every installed module's web declaration, in name order. */
export const webModules = [
  annotationWeb satisfies { readonly name: "annotation" },
] as const;
import type { serverModules } from "./server-modules.generated";
export const webModulePackages = {} as const;
type PairedOnDisk = never;
type MissingWeb = Exclude<PairedOnDisk, (typeof webModules)[number]["name"]>;
type MissingServer = Exclude<PairedOnDisk, (typeof serverModules)[number]["name"]>;
export const webModulePairing = {} satisfies {
  [Id in `missing web half "${MissingWeb}"` | `missing server half "${MissingServer}"`]: never;
};
