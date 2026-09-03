/**
 * The pages `apps/ui` serves itself — `ui-page-loaders` describes the
 * seam; a page under `apps/ui/src` registers its key here, and the merge
 * below decides which registry answers for it.
 */

import type { UiPageLoaderRegistry } from "./ui-page-loaders";

/**
 * Every page this package serves from its own source — empty until a
 * family moves in; the host registry answers for everything else.
 */
export const uiFeatureLoaders: UiPageLoaderRegistry = {};

export type UiPageLoaderMerge = {
  /** What `apps/ui` serves itself. */
  own: UiPageLoaderRegistry;
  /** What the composing application still serves. */
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
