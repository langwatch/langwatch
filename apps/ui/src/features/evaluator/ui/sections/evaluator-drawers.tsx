/**
 * The evaluator drawers, mounted in the host their package asks for.
 *
 * A DRAWER IS NOT A PAGE, and the difference is what this file exists for: a
 * page is mounted by the route it answers, so its frontend feature wraps it
 * once in `withEvaluatorHost` there. A drawer opens OVER whatever page the
 * reader is on — the evaluators list, a workflow, a trace — so the host has to
 * travel with the drawer rather than with the address. Wrapping happens here,
 * once, and the whole file is behind the registry's lazy import, so a reader
 * who never opens an evaluator drawer never downloads the adapter either.
 */

import {
  EvaluatorHistoryPanel,
  EvaluatorListDrawer as EvaluatorList,
} from "@langwatch/evaluator-web/drawers";
import { useDrawer } from "@langwatch/ui-drawer";

import { withEvaluatorHost } from "./evaluator-host-provider";

/**
 * `evaluatorHistory`, as the address spells it.
 *
 * The two identifiers arrive as `drawer.evaluatorId` and
 * `drawer.evaluatorName`. A link that lost the id has nothing to show, so it
 * renders nothing rather than an empty history somebody would read as "no
 * changes recorded".
 */
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

export const EvaluatorHistoryDrawer = withEvaluatorHost(EvaluatorHistory);

export const EvaluatorListDrawer = withEvaluatorHost(EvaluatorList);
