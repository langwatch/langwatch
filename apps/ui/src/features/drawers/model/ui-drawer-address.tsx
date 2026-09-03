/**
 * The one thing every registered drawer has to be told about its address.
 *
 * `CurrentDrawer` spreads the PARSED ADDRESS onto the component it resolved, so
 * the `open` a drawer receives is `?drawer.open=<name>` — the string
 * `"inviteMember"`, never `true`. Most drawers read it defensively (`open !==
 * false && open !== undefined`) and survive; the ones that pass it straight to
 * Chakra's `Drawer.Root`, or compare it with `=== true`, render CLOSED against
 * an address that says they are open. That is the defect `agent-drawers.tsx`
 * recorded when the agent type selector moved, one drawer at a time, and it is
 * the same defect every time — so the rule is stated once here and the
 * application's drawer adapters wrap with it.
 *
 * IT IS THIS APPLICATION'S AND NOT `@langwatch/ui-drawer`'s. The framework's
 * contract is deliberately "the address's keys arrive as props"; what a given
 * component wants `open` to be typed as is the composing application's problem,
 * which is exactly what an adapter is for.
 */

import type { ComponentType } from "react";

/** The query parameter that names which drawer is open. */
export const DRAWER_OPEN_PARAM = "drawer.open";

/** Whether an address that named a drawer means it is open. */
export function isDrawerOpenFromAddress(open: unknown): boolean {
  return open !== false && open !== void 0;
}

/**
 * A drawer, with the address's `open` turned into the boolean it wants.
 *
 * Everything else the registry spread — the `drawer.<key>` parameters, the
 * in-memory complex props and the flow callbacks — is passed through untouched,
 * because a drawer that only reads the props it declared would otherwise lose
 * the callback a caller registered for it.
 */
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
