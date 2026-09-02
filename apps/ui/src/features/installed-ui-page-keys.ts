/**
 * Which page keys THIS package serves, as a question a component can ask.
 *
 * The chrome layout route is the one caller: a page `platform/app` still serves
 * draws its own header, so the chrome has to know which half of the product is
 * about to render before it draws a second one. The answer is the standing
 * declaration's own loader list and nothing else.
 *
 * READ LAZILY, ON PURPOSE. This module and the registry it reads are two halves
 * of one cycle — the registry composes the chrome feature, and the chrome
 * feature asks this — and a top-level `Object.keys` would run while the registry
 * is still initialising. A function body runs on the first render instead, long
 * after every module has settled, and the set is built once.
 */

import { installedUiFeatures } from "./installed-ui-features";

let installedKeys: ReadonlySet<string> | undefined;

export function isUiInstalledPage(key: string): boolean {
  installedKeys ??= new Set(Object.keys(installedUiFeatures.loaders ?? {}));
  return installedKeys.has(key);
}
