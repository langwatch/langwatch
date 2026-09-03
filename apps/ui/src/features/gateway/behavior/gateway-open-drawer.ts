/**
 * Puts a registered drawer's address in the URL.
 *
 * `params` are the drawer's own parameter names, unprefixed — the `drawer.`
 * vocabulary belongs to the host, which writes `?drawer.open=<drawer>` plus
 * one `drawer.<name>` per parameter and clears every stale `drawer.*` key, so
 * a previous drawer's parameters never leak into the next one that opens.
 */

import type { GatewayDrawer } from "@langwatch/gateway-web/screens/gateway";

export function openGatewayDrawer({
  drawer,
  params = {},
  query,
  drawerOpenParam,
  setQuery,
}: {
  drawer: GatewayDrawer;
  params?: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
  /** `DRAWER_OPEN_PARAM`, passed in rather than imported: a `behavior/` module
   * may not compose another private feature's entry. */
  drawerOpenParam: string;
  setQuery: (next: Readonly<Record<string, string | undefined>>) => void;
}): void {
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
