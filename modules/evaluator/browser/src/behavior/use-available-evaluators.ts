import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import type { CustomEvaluator } from "@langwatch/evaluation-contract";
import { AVAILABLE_EVALUATORS, type EvaluatorDefinition } from "@langwatch/evaluator-contract";
import { getInputsOutputs } from "@langwatch/workflow-contract";
import { useMemo } from "react";

export const useAvailableEvaluators = ():
  | Readonly<Record<string, EvaluatorDefinition>>
  | undefined => {
  const { project } = useOrganizationTeamProject();

  const availableCustomEvaluators = api.evaluations.availableCustomEvaluators.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const availableEvaluators = useMemo(() => {
    if (!availableCustomEvaluators.data) {
      return undefined;
    }
    return {
      ...AVAILABLE_EVALUATORS,
      ...Object.fromEntries(
        (availableCustomEvaluators.data ?? []).map((evaluator: CustomEvaluator) => {
          const dsl = JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl));
          const { inputs } = getInputsOutputs(dsl?.edges, dsl?.nodes);
          const requiredFields = inputs.map((input) => input.identifier);

          return [
            `custom/${evaluator.id}`,
            {
              name: evaluator.name,
              description: describeCustomEvaluator(evaluator),
              category: "custom",
              isGuardrail: false,
              requiredFields: requiredFields,
              optionalFields: [],
              settings: {},
              result: {},
              envVars: [],
            },
          ];
        }),
      ),
    };
  }, [availableCustomEvaluators.data]);

  return availableEvaluators;
};

function describeCustomEvaluator(evaluator: CustomEvaluator): string {
  return typeof evaluator.description === "string" ? evaluator.description : "";
}
