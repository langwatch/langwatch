/**
 * Where the account dropdown offers the presence toggle.
 *
 * Presence is broadcast from the Trace Explorer and nowhere else, so the row
 * is offered there and absent everywhere else rather than shown inert.
 */

const TRACES_ROUTE_PATTERN = "/:project/traces";

export function showsPresenceMenuItem(routePattern: string): boolean {
  return (
    routePattern === TRACES_ROUTE_PATTERN || routePattern.startsWith(`${TRACES_ROUTE_PATTERN}/`)
  );
}
