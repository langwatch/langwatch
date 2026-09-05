/**
 * Coerces a drawer's parsed `open` address param (a name string, never
 * `true`) to the boolean this application's own drawers want. See
 * dev/docs/best_practices/drawers.md#host-wrapping-in-appsui.
 */

import type { ComponentType } from "react";

/** The query parameter that names which drawer is open. */
export const DRAWER_OPEN_PARAM = "drawer.open";

/** Whether an address that named a drawer means it is open. */
export function isDrawerOpenFromAddress(open: unknown): boolean {
  return open !== false && open !== void 0;
}

/** A drawer, with the address's `open` turned into the boolean it wants; every other prop passes through untouched. */
export function fromDrawerAddress<P extends { open?: boolean }>(
  Drawer: ComponentType<P>,
): ComponentType<Omit<P, "open"> & { open?: unknown }> {
  const Mounted = ({ open, ...rest }: Omit<P, "open"> & { open?: unknown }) => (
    // `rest` is `P` without the one prop being replaced, and TypeScript cannot
    // see that through the generic, so the reassembly is stated rather than
    // inferred.
    <Drawer {...(rest as unknown as P)} open={isDrawerOpenFromAddress(open)} />
  );
  Mounted.displayName = `fromDrawerAddress(${Drawer.displayName ?? Drawer.name ?? "Drawer"})`;
  return Mounted;
}
