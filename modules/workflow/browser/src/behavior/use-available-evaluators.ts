import { api, type RouterOutputs } from "@langwatch/browser-trpc/workflow-api";
import { evaluatorCatalogueWith } from "@langwatch/evaluator-browser-kit";
import type { EvaluatorDefinition } from "@langwatch/evaluator-contract";
import { getInputsOutputs } from "@langwatch/workflow-contract";
import { useMemo } from "react";

import { useOrganizationTeamProject } from "./studio-host/use-organization-team-project.ts";

type CustomEvaluator = RouterOutputs["evaluations"]["availableCustomEvaluators"][number];

export const useAvailableEvaluators = ():
  | Readonly<Record<string, EvaluatorDefinition>>
  | undefined => {
  const { project } = useOrganizationTeamProject();

  const availableCustomEvaluators = api.evaluations.availableCustomEvaluators.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  return useMemo(
    () =>
      availableCustomEvaluators.data
        ? evaluatorCatalogueWith(availableCustomEvaluators.data.map(summarizeCustomEvaluator))
        : undefined,
    [availableCustomEvaluators.data],
  );
};

function summarizeCustomEvaluator(evaluator: CustomEvaluator) {
  const dsl = JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl));
  const { inputs } = getInputsOutputs(dsl?.edges, dsl?.nodes);
  return {
    id: evaluator.id,
    name: evaluator.name,
    description: evaluator.description,
    requiredFields: inputs.map((input) => input.identifier),
  };
}
