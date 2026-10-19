/**
 * The saved evaluators of the project, keyed by id — how an attachment
 * names the evaluator it runs. One read for every pill and editor: suite
 * editor, header line and run dialog all resolve an attachment through it.
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { evaluatorClient } from "@langwatch/evaluator-client";
import { useMemo } from "react";

import type { AttachableEvaluator } from "../../../model/agent-testing/evaluators/attachment-rules.ts";

export function useProjectEvaluators({
  enabled = true,
}: {
  enabled?: boolean;
} = {}): {
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  isLoading: boolean;
} {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { data, isLoading } = evaluatorClient.evaluators.getAll.useQuery(
    { projectId },
    { enabled: enabled && !!projectId },
  );

  const evaluatorsById = useMemo(() => {
    const byId = new Map<string, AttachableEvaluator>();
    for (const evaluator of data ?? []) byId.set(evaluator.id, evaluator);
    return byId;
  }, [data]);

  return { evaluatorsById, isLoading };
}
