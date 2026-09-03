/**
 * The experiment drawers, mounted in the host their package asks for. Both
 * mount the workflow host, not one of their own, since their closures
 * reach `@langwatch/workflow-web/studio-host/*` and share its tRPC cache.
 */

import {
  ComparisonLeaderboardDrawer as ComparisonLeaderboard,
  TargetTypeSelectorDrawer as TargetTypeSelector,
  type ComparisonLeaderboardDrawerProps,
} from "@langwatch/experiment-web/drawers";

import { withWorkflowHost } from "../../../workflows/ui/sections/workflows-host";

/** The grant this family's replicate picker asks about, per target project. */
const EXPERIMENT_COPY_PERMISSION = "evaluations:manage";

/** `comparisonLeaderboard`. No `evaluatorId` means no comparison, so it renders null rather than an "open the run" sentence for one that doesn't exist. */
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
