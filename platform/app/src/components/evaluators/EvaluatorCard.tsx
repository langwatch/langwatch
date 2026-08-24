import {
  EvaluatorCard as EvaluatorCardPresentation,
  type EvaluatorCardProps as EvaluatorCardPresentationProps,
} from "@langwatch/evaluator-web";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { useState } from "react";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { evaluationContextChip } from "~/features/langy/logic/langyContextChips";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { EvaluatorApiUsageDialog } from "./EvaluatorApiUsageDialog";

export type EvaluatorWithCopyCount = Evaluator;

export type EvaluatorCardProps = Omit<
  EvaluatorCardPresentationProps,
  "evaluator" | "updatedAtLabel" | "onUseFromApi"
> & {
  evaluator: EvaluatorWithCopyCount;
  onUseFromApi?: () => void;
};

/** App composition seam for API usage, Langy targeting, and relative-time formatting. */
export function EvaluatorCard({
  evaluator,
  onUseFromApi,
  ...props
}: EvaluatorCardProps) {
  const [showApiDialog, setShowApiDialog] = useState(false);
  const handleUseFromApi = () => {
    if (onUseFromApi) {
      onUseFromApi();
      return;
    }
    setShowApiDialog(true);
  };

  return (
    <>
      <LangyContextTarget
        target={evaluationContextChip({
          evaluationId: evaluator.id,
          name: evaluator.name,
          noun: "evaluator",
        })}
      >
        <EvaluatorCardPresentation
          {...props}
          evaluator={evaluator}
          updatedAtLabel={formatTimeAgo(new Date(evaluator.updatedAt).getTime())}
          onUseFromApi={handleUseFromApi}
        />
      </LangyContextTarget>
      <EvaluatorApiUsageDialog
        evaluator={evaluator}
        open={showApiDialog}
        onClose={() => setShowApiDialog(false)}
      />
    </>
  );
}
