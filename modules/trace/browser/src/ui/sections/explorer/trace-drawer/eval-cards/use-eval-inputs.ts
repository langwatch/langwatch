import { useMemo } from "react";

import { useIsReadOnlyTrace } from "../../../../../behavior/explorer/context/trace-viewer-context.tsx";
import { useTraceQueryArgs } from "../../../../../behavior/explorer/use-trace-query-args.ts";
import { api } from "../../../../../behavior/trace-api.ts";
import type { EvalEntry } from "./utils.ts";

export interface ResolvedEvalInputs {
  inputEntries: [string, unknown][];
  isLoading: boolean;
}

/**
 * Resolves an evaluation's `inputs` for the expanded details panel.
 */
export function useEvalInputs({
  eval_,
  enabled,
}: {
  eval_: EvalEntry;
  enabled: boolean;
}): ResolvedEvalInputs {
  const { projectId, tenantId } = useTraceQueryArgs();
  const isReadOnly = useIsReadOnlyTrace();

  const listInputs = eval_.inputs && Object.keys(eval_.inputs).length > 0 ? eval_.inputs : null;

  const needLazy = enabled && !listInputs && !!eval_.evaluationId && !!projectId && !isReadOnly;

  const query = api.evaluations.getEvaluationInputs.useQuery(
    {
      projectId,
      evaluationId: eval_.evaluationId ?? "",
      // On an aggregate, the member the drawer is on holds the evaluation.
      ...(tenantId !== null ? { tenantId } : {}),
    },
    {
      enabled: needLazy,
    },
  );

  return useMemo(() => {
    const inputs = listInputs ?? query.data ?? null;
    return {
      inputEntries: inputs ? Object.entries(inputs) : [],
      isLoading: needLazy && query.isLoading,
    };
  }, [listInputs, query.data, needLazy, query.isLoading]);
}
