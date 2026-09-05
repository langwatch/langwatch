import { useMemo } from "react";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project";
import { api } from "../../../trace-api";
import { useIsReadOnlyTrace } from "../../../../elements/explorer/context/trace-viewer-context";
import type { EvalEntry } from "./utils";

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
  const { project } = useOrganizationTeamProject();
  const isReadOnly = useIsReadOnlyTrace();

  const listInputs = eval_.inputs && Object.keys(eval_.inputs).length > 0 ? eval_.inputs : null;

  const needLazy = enabled && !listInputs && !!eval_.evaluationId && !!project?.id && !isReadOnly;

  const query = api.traces.getEvaluationInputs.useQuery(
    {
      projectId: project?.id ?? "",
      evaluationId: eval_.evaluationId ?? "",
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
