/**
 * The Foundry, as a drawer over whatever an operator is already reading —
 * the command palette's `?drawer.open=foundry` twin of `/ops/foundry`.
 * Needs both `OpsHost` and `FoundryTransport`, same pair the page mounts.
 */

import { FoundryDrawer as Foundry, FoundryTransport } from "@langwatch/ops-web/drawers";
import { useDrawer } from "@langwatch/ui-drawer";

import { withHost } from "../../../../ui/sections/ui-page";
import { OpsHost } from "./ops-host";

/**
 * The drawer takes the close as a callback rather than closing itself, which is
 * the framework's rule: a drawer that calls `closeDrawer` clears the whole
 * navigation stack, and the registry is what owns the address it opened from.
 */
function FoundryFromAddress() {
  const { closeDrawer } = useDrawer();

  return (
    <FoundryTransport>
      <Foundry onClose={closeDrawer} />
    </FoundryTransport>
  );
}

export const FoundryDrawer = withHost(OpsHost, FoundryFromAddress);
