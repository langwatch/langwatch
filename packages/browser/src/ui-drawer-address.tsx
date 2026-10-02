/**
 * How a drawer's `open` query parameter reads as an address: the param names
 * the open drawer (a name string, never `true`).
 */

/** The query parameter that names which drawer is open. */
export const DRAWER_OPEN_PARAM = "drawer.open";

/** Whether an address that named a drawer means it is open. */
export function isDrawerOpenFromAddress(open: unknown): boolean {
  return open !== false && open !== void 0;
}
