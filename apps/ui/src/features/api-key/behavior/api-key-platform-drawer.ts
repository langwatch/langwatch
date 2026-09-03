/**
 * The address a `platform/app` drawer opens at, written the way `openDrawer`
 * writes it: every stale `drawer.*` key is dropped first, which is what makes
 * an editor open on the row the reader looked at before this one.
 */

import type { ApiKeyPlatformDrawer } from "@langwatch/api-key-web/screens/api-key";

export function openPlatformDrawer({
  query,
  drawer,
  params = {},
  openParam,
  setQuery,
}: {
  query: Readonly<Record<string, string | undefined>>;
  drawer: ApiKeyPlatformDrawer;
  params?: Readonly<Record<string, string | undefined>>;
  openParam: string;
  setQuery: (next: Readonly<Record<string, string | undefined>>) => void;
}): void {
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("drawer.")) next[key] = value;
  }
  next[openParam] = drawer;
  for (const [name, value] of Object.entries(params)) {
    if (value !== void 0) next[`drawer.${name}`] = value;
  }
  setQuery(next);
}
