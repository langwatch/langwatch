/**
 * The one piece of drawer vocabulary this family writes.
 *
 * `openPlatformDrawer` IS THE PLATFORM VOCABULARY THIS FAMILY KEEPS, the same
 * way the agents family kept `openAgentEditor`. The provider editor, the
 * default-model override and the model-cost editor are registered drawers in
 * `platform/app`; two of them have openers outside this family (the evaluator
 * type selector, and the unmapped-cost suggestion in a trace), so the move may
 * not delete them, and a screen may not carry a copy of a drawer registry. The
 * screen names the drawer and this writes the address the rest of the product
 * already produces — the same `?drawer.open=…&drawer.<name>=…` params
 * `openDrawer` writes, including its clearing of every other `drawer.*` key.
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
