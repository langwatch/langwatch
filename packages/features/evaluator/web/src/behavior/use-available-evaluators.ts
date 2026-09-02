import type { JsonArray } from "@langwatch/workflow-web/model/prisma-types";
import type { Edge, Node } from "@xyflow/react";
import { useMemo } from "react";
import { getInputsOutputs } from "@langwatch/workflow-contract";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";

export const useAvailableEvaluators = ():
  | Record<EvaluatorTypes | `custom/${string}`, EvaluatorDefinition<EvaluatorTypes>>
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
        (availableCustomEvaluators.data ?? []).map((evaluator: any) => {
          const { inputs } = getInputsOutputs(
            JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl))?.edges as Edge[],
            JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl))
              ?.nodes as JsonArray as unknown[] as Node[],
          );
          const requiredFields = inputs.map((input) => input.identifier);

          return [
            `custom/${evaluator.id}`,
            {
              name: evaluator.name,
              description: evaluator.description,
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
