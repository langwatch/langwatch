/**
 * One evaluator in the grid, with its "Use via API" dialog attached.
 */

import type { Evaluator } from "@langwatch/evaluator-contract";
import { useState } from "react";

import { formatTimeAgo } from "@langwatch/ui-host/format-time-ago";
import { EvaluatorApiUsageDialog } from "./evaluator-api-usage-dialog";
import { EvaluatorCard, type EvaluatorCardProps } from "./evaluator-card";

export type EvaluatorGridCardProps = Omit<
  EvaluatorCardProps,
  "evaluator" | "updatedAtLabel" | "onUseFromApi"
> & { evaluator: Evaluator };

export function EvaluatorGridCard({ evaluator, ...props }: EvaluatorGridCardProps) {
  const [showApiDialog, setShowApiDialog] = useState(false);

  return (
    <>
      <EvaluatorCard
        {...props}
        evaluator={evaluator}
        updatedAtLabel={formatTimeAgo(new Date(evaluator.updatedAt).getTime()) ?? ""}
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
