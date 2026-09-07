/**
 * One evaluator in the grid, with its "Use via API" dialog attached.
 */

import type { Evaluator } from "@langwatch/evaluator-contract";
import { toEpochMs } from "@langwatch/time";
import type { WireOf } from "@langwatch/platform-api-client/feature-api";
import { useState } from "react";

import { formatTimeAgo } from "@langwatch/ui-host/format-time-ago";
import { EvaluatorApiUsageDialog } from "./evaluator-api-usage-dialog.tsx";
import { EvaluatorCard, type EvaluatorCardProps } from "./evaluator-card.tsx";

export type EvaluatorGridCardProps = Omit<
  EvaluatorCardProps,
  "evaluator" | "updatedAtLabel" | "onUseFromApi"
> & { evaluator: WireOf<Evaluator> };

export function EvaluatorGridCard({ evaluator, ...props }: EvaluatorGridCardProps) {
  const [showApiDialog, setShowApiDialog] = useState(false);

  return (
    <>
      <EvaluatorCard
        {...props}
        evaluator={evaluator}
        updatedAtLabel={formatTimeAgo(toEpochMs(evaluator.updatedAt)) ?? ""}
        onUseFromApi={() => setShowApiDialog(true)}
      />
      <EvaluatorApiUsageDialog
        evaluator={evaluator}
        open={showApiDialog}
        onClose={() => setShowApiDialog(false)}
      />
    </>
  );
}
