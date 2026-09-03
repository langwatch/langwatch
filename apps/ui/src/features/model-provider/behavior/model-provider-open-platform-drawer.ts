/**
 * Writes the address the rest of the product already uses to open one of
 * this family's drawers — same params and stale-key clearing `openDrawer`
 * produces. Two of the three drawers have openers outside this family.
 */

import type { ModelProviderPlatformDrawer } from "@langwatch/model-provider-web/screens/model-provider";

export function openPlatformDrawer({
  drawer,
  params = {},
  query,
  drawerOpenParam,
  setQuery,
}: {
  drawer: ModelProviderPlatformDrawer;
  params?: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
  /** The query parameter that names which drawer is open (`features/drawers`'s `DRAWER_OPEN_PARAM`). */
  drawerOpenParam: string;
  setQuery: (next: Readonly<Record<string, string | undefined>>) => void;
}): void {
  // Every other `drawer.*` key is dropped, exactly as `openDrawer` does:
  // leaving a previous drawer's parameters behind is what makes an editor open
  // on the row the reader looked at before this one.
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("drawer.")) next[key] = value;
  }
  next[drawerOpenParam] = drawer;
  for (const [name, value] of Object.entries(params)) {
    if (value !== void 0) next[`drawer.${name}`] = value;
  }
  setQuery(next);
}
