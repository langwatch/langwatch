/**
 * The evaluator drawers, mounted in the host their package asks for; the
 * host travels with the drawer, not the address. See
 * dev/docs/best_practices/drawers.md#host-wrapping-in-appsui.
 */

import {
  EvaluatorHistoryPanel,
  EvaluatorListDrawer as EvaluatorList,
} from "@langwatch/evaluator-web/drawers";
import { useDrawer } from "@langwatch/ui-drawer";

import { withHost } from "../../../../ui/sections/ui-page";
import { EvaluatorHost } from "./evaluator-host";

/** `evaluatorHistory`. No `drawer.evaluatorId` means nothing to show, so it renders null rather than an empty-looking history. */
function EvaluatorHistory({
  evaluatorId,
  evaluatorName,
}: {
  evaluatorId?: string;
  evaluatorName?: string;
}) {
  const { closeDrawer } = useDrawer();
  if (!evaluatorId) return null;

  return (
    <EvaluatorHistoryPanel
      evaluatorId={evaluatorId}
      evaluatorName={evaluatorName ?? ""}
      onClose={closeDrawer}
    />
  );
}

export const EvaluatorHistoryDrawer = withHost(EvaluatorHost, EvaluatorHistory);

export const EvaluatorListDrawer = withHost(EvaluatorHost, EvaluatorList);
