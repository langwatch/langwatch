/**
 * Addresses the table names that no installed module answers for yet. The
 * router resolves every descriptor when it is BUILT, so one unregistered key
 * takes the whole browser down; these keep the gap at its own address.
 */

import type { UiPageLoaderRegistry } from "@langwatch/browser/feature-install";

/**
 * The list only ever shrinks: a module declaring one of these keys makes its
 * entry here dead, which `every-route-page-is-declared` fails on.
 */
export const uiUnservedPageLoaders: UiPageLoaderRegistry = {};
