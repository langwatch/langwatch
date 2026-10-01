/**
 * The drawer stack, as the address carries it: the open drawer and its params
 * are the URL, the drawers beneath it ride in `history.state`. Nothing here is
 * held in memory, so Back, a reload and a shared link all see the same stack.
 */

export type DrawerStackEntry = {
  drawer: string;
  params: Record<string, unknown>;
};

/** The one-level object a drawer's params are; anything else adds nothing. */
function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function toEntry(value: unknown): DrawerStackEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("drawer" in value) || typeof value.drawer !== "string") return undefined;
  const params = "params" in value ? toRecord(value.params) : {};
  return { drawer: value.drawer, params };
}

/** The drawers beneath the open one, read from a location's `state`; anything malformed is empty. */
export function readDrawerAncestors(state: unknown): DrawerStackEntry[] {
  if (typeof state !== "object" || state === null) return [];
  if (!("drawerStack" in state) || !Array.isArray(state.drawerStack)) return [];
  return state.drawerStack.flatMap((entry) => toEntry(entry) ?? []);
}

/** The `state` that carries these ancestors; `null` when there are none, so a clean address stays clean. */
export function drawerAncestorsState(
  ancestors: readonly DrawerStackEntry[],
): { drawerStack: DrawerStackEntry[] } | null {
  return ancestors.length === 0 ? null : { drawerStack: [...ancestors] };
}

/** The `drawer.<key>` params of a flat query, `drawer.open` excluded. */
export function drawerParamsOfQuery(
  query: Readonly<Record<string, string | undefined>>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith("drawer.") && key !== "drawer.open") {
      params[key.replace("drawer.", "")] = value;
    }
  }
  return params;
}

/** The whole stack, the open drawer on top. Empty when no drawer is open. */
export function readDrawerStack({
  state,
  query,
}: {
  state: unknown;
  query: Readonly<Record<string, string | undefined>>;
}): DrawerStackEntry[] {
  const open = query["drawer.open"];
  if (!open) return [];
  return [...readDrawerAncestors(state), { drawer: open, params: drawerParamsOfQuery(query) }];
}

/**
 * Ancestors after opening `next`: none on a reset, the same on a replace, else
 * the open drawer joins them; a drawer already in the stack returns to it.
 * `forward` stacks the open drawer even when `next` is the same drawer.
 */
export function ancestorsAfterOpen({
  ancestors,
  current,
  next,
  resetStack,
  replaceCurrentInStack,
  forward,
}: {
  ancestors: readonly DrawerStackEntry[];
  current: DrawerStackEntry | undefined;
  next: string;
  resetStack?: boolean;
  replaceCurrentInStack?: boolean;
  forward?: boolean;
}): DrawerStackEntry[] {
  if (resetStack || !current) return [];
  if (replaceCurrentInStack) return [...ancestors];
  const withCurrent = [...ancestors, current];
  if (forward) return withCurrent;
  const existing = withCurrent.findIndex((entry) => entry.drawer === next);
  return existing === -1 ? withCurrent : withCurrent.slice(0, existing);
}
