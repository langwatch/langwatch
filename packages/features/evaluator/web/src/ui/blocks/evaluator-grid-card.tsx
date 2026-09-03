/**
 * One evaluator in the grid, with its "Use via API" dialog attached.
 *
 * The presentation card is this package's own (`evaluator-card.tsx`) and was
 * already shared with the evaluator list drawer; what `platform/app` wrapped
 * around it was three things — a relative-time label, the API usage dialog and
 * a Langy context target. Two travelled.
 *
 * THE LANGY TARGET DID NOT. `@langwatch/langy-web` is ungoverned and every
 * consumer compiles its source, which needs an `es2023` library and a
 * stylesheet declaration this package would have had to adopt globally. The me,
 * automations and analytics families refused it for the same reason; this is
 * the fourth refusal, recorded rather than worked around.
 */

import type { Evaluator } from "@langwatch/evaluator-contract";
import { useState } from "react";

import { formatTimeAgo } from "../../model/format-time-ago";
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
