/**
 * Where every routed page still lives.
 *
 * `@langwatch/ui` owns the route table — the paths, their nesting and their
 * page keys — and this is the other half of that seam: the key-to-module
 * install list the browser composition hands it. The pages themselves have not
 * moved out of this application yet, so each key resolves to a lazy import of
 * the module that has always served it.
 *
 * Several addresses share one screen. Where they do, every key names the
 * shared module — the file that used to sit at the extra address and re-export
 * it is gone — and a key whose address is served by a named export rather than
 * the default names that export. Which component each of those keys resolves
 * is pinned in `legacy-page-loaders.unit.test.ts`.
 *
 * As a page migrates into a feature-web `screens/` entry, only its line here
 * changes. The route table, the URL and the loader key stay exactly as they
 * are, which is what keeps the move invisible to a bookmark.
 *
 * `legacy-page-loaders.unit.test.ts` pins this registry to the table: every
 * key the table names is registered, and nothing is registered that the table
 * does not name.
 */

import type { UiPageLoaderRegistry } from "@langwatch/ui";

export const legacyPageLoaders: UiPageLoaderRegistry = {
};
