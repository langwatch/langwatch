/**
 * The Foundry, as a drawer over whatever an operator is already reading.
 *
 * TWO MOUNTS OF ONE PLAYGROUND. `/ops/foundry` is the page; `?drawer.open=foundry`
 * is what the command palette writes, from two entries, so an operator can
 * build and send a trace without leaving the dashboard they are diagnosing.
 * The page was registered and the drawer was not, so the palette entry opened
 * nothing.
 *
 * IT NEEDS TWO THINGS AROUND IT, not one. `withOpsHost` answers for the project
 * an operator is standing in; `FoundryTransport` turns that answer, plus the
 * organization graph, into the runtime the playground reads for the API key it
 * sends a generated trace with. The page mounts the same pair, and this file is
 * behind the registry's lazy import, so neither is downloaded until the drawer
 * is opened.
 *
 * `includeProjects` IS FALSE HERE. The page offers a project picker, because an
 * operator on `/ops/foundry` chose to go there to work on some project; the
 * drawer is opened over a page that already fixed one, so it sends as that
 * project and does not fetch every project in the deployment to offer a
 * question nobody asked.
 */

import { FoundryDrawer as Foundry, FoundryTransport } from "@langwatch/ops-web/drawers";
import { useDrawer } from "@langwatch/ui-drawer";

import { withOpsHost } from "./ops-host-provider";

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

export const FoundryDrawer = withOpsHost(FoundryFromAddress);
