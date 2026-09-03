/**
 * The experiment drawers, mounted in the host their package asks for.
 *
 * A DRAWER IS NOT A PAGE, and that is what this file exists for: a page is
 * mounted by the route it answers, so `experiment-routes.tsx` wraps each screen
 * in `withWorkflowHost` there. A drawer opens OVER whatever page the reader is
 * on — the workbench, a run's results, an evaluation — so the host travels with
 * the drawer rather than with the address. Wrapping happens here, once, and the
 * whole file sits behind the registry's lazy import, so a reader who never
 * opens one never downloads the host either.
 *
 * THE HOST IS THE WORKFLOW HOST, for the same reason the pages use it: both
 * drawers' closures reach `@langwatch/workflow-web/studio-host/*` —
 * `useShowComparisonLeaderboard` reads the project and the feature flag through
 * it — so a port of this family's own would split the tRPC cache and leave
 * those hooks asking a host nothing mounted.
 *
 * NEITHER DRAWER READS A `drawer.` PARAMETER IT CANNOT DEFEND. The address
 * carries `drawer.evaluatorId` for the leaderboard and nothing at all for the
 * picker; everything else both need is far too large for a query string and
 * arrives through the navigator's in-memory props slot, which `CurrentDrawer`
 * spreads alongside the parsed address. The leaderboard says so itself rather
 * than dereferencing what a pasted link cannot carry.
 */

import {
  ComparisonLeaderboardDrawer as ComparisonLeaderboard,
  TargetTypeSelectorDrawer as TargetTypeSelector,
  type ComparisonLeaderboardDrawerProps,
} from "@langwatch/experiment-web/drawers";

import { withWorkflowHost } from "../../../workflows/ui/sections/workflows-host";

/** The grant this family's replicate picker asks about, per target project. */
const EXPERIMENT_COPY_PERMISSION = "evaluations:manage";

/**
 * `comparisonLeaderboard`, as the address spells it.
 *
 * Only `evaluatorId` survives a URL, and a link that lost it names no
 * comparison at all — so it renders nothing rather than the "open the run"
 * sentence, which would otherwise claim a leaderboard exists for a comparison
 * nobody asked about.
 */
function ComparisonLeaderboardFromAddress({
  evaluatorId,
  ...rest
}: Omit<ComparisonLeaderboardDrawerProps, "evaluatorId"> & { evaluatorId?: string }) {
  if (!evaluatorId) return null;

  return <ComparisonLeaderboard evaluatorId={evaluatorId} {...rest} />;
}

export const ComparisonLeaderboardDrawer = withWorkflowHost(ComparisonLeaderboardFromAddress, {
  copyPermission: EXPERIMENT_COPY_PERMISSION,
});

export const TargetTypeSelectorDrawer = withWorkflowHost(TargetTypeSelector, {
  copyPermission: EXPERIMENT_COPY_PERMISSION,
});
