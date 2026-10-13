import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import type { CustomEvaluator } from "@langwatch/evaluation-contract";
import type { EvaluatorDefinition } from "@langwatch/evaluator-contract";
import { getInputsOutputs } from "@langwatch/workflow-contract";
import { useMemo } from "react";

import { evaluatorCatalogueWith } from "../model/custom-evaluator-catalogue.ts";
import { evaluatorApi } from "./evaluator-api.ts";

export const useAvailableEvaluators = ():
  | Readonly<Record<string, EvaluatorDefinition>>
  | undefined => {
  const { project } = useOrganizationTeamProject();

  const availableCustomEvaluators = evaluatorApi.evaluations.availableCustomEvaluators.useQuery(
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
