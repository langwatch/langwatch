/**
 * The pages `apps/ui` serves itself, and how they meet the host's.
 *
 * `ui-page-loaders` describes the seam; this module is the half of it that
 * belongs to this package. A page whose module lives under `apps/ui/src`
 * registers its key here, and the composing application never learns that it
 * moved — the route table already named the key, and the merge below decides
 * which registry answers for it.
 */

import type { UiPageLoaderRegistry } from "./ui-page-loaders";

/**
 * Every page this package serves from its own source.
 *
 * Empty while the first screen family is still in `platform/app`: the host
 * registry answers for all 136 keys the route table names. A move adds one
 * entry here and deletes nothing on the host, which is what makes the two
 * halves independently landable.
 */
export const uiFeatureLoaders: UiPageLoaderRegistry = {};

export type UiPageLoaderMerge = {
  /** What `apps/ui` serves itself. */
  own: UiPageLoaderRegistry;
  /** What the composing application still serves. */
  host: UiPageLoaderRegistry;
};

/**
 * One registry for the router, own entries first.
 *
 * Own wins on a shared key, deliberately. During a move both halves register
 * the same key for a while — the host's loader still points at the page that
 * has not been deleted yet — and the moved page is the one that should be
 * served. Host-wins would make a completed move invisible until someone
 * remembered to delete the old entry in a package this slice may not touch,
 * so the shadowing is the migration's forward gear rather than an accident.
 */
export function mergeUiPageLoaders({ own, host }: UiPageLoaderMerge): UiPageLoaderRegistry {
  return { ...host, ...own };
}
