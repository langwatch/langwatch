import { useMemo } from "react";
import { api } from "~/utils/api";
import { useIsReadOnlyTrace } from "../../../context/TraceViewerContext";
import { useTraceQueryArgs } from "../../../hooks/useTraceQueryArgs";
import type { EvalEntry } from "./utils";

export interface ResolvedEvalInputs {
  inputEntries: [string, unknown][];
  isLoading: boolean;
}

/**
 * Resolves an evaluation's `inputs` for the expanded details panel.
 *
 * The verdict list (`traces.getEvaluations`) carries inputs in the common
 * case, but under ClickHouse memory pressure the server drops the heavy
 * `Inputs` column to avoid a 500 (see clickhouse-evaluation.service). When
 * the list didn't provide them, this fetches the inputs for just this one
 * evaluation — keyed by evaluation id, which is the table's sort key, so the
 * read prunes granules and can't blow the memory ceiling. The fetch only
 * fires while the panel is open and the list didn't already carry inputs, so
 * the heavy blob never ships on drawer open for collapsed cards.
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

  const listInputs =
    eval_.inputs && Object.keys(eval_.inputs).length > 0 ? eval_.inputs : null;

  const needLazy =
    enabled &&
    !listInputs &&
    !!eval_.evaluationId &&
    !!projectId &&
    !isReadOnly;

  const query = api.traces.getEvaluationInputs.useQuery(
    {
      projectId,
      evaluationId: eval_.evaluationId ?? "",
      // On an aggregate, the member the drawer is on holds the evaluation.
      ...(tenantId !== null ? { tenantId } : {}),
    },
    {
      enabled: needLazy,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
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
