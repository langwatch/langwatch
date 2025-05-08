import { useMemo } from "react";

import { api } from "../utils/api";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "../server/evaluations/evaluators.generated";
import { getInputsOutputs } from "../optimization_studio/utils/nodeUtils";
import type { Node, Edge } from "@xyflow/react";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import type { JsonArray } from "@prisma/client/runtime/library";

export const useAvailableEvaluators = ():
  | Record<
      EvaluatorTypes | `custom/${string}`,
      EvaluatorDefinition<EvaluatorTypes>
    >
  | undefined => {
  const { project } = useOrganizationTeamProject();

  const availableCustomEvaluators =
    api.evaluations.availableCustomEvaluators.useQuery(
      { projectId: project?.id ?? "" },
      { enabled: !!project }
    );

  const availableEvaluators = useMemo(() => {
    if (!availableCustomEvaluators.data) {
      return undefined;
    }
    return {
      ...AVAILABLE_EVALUATORS,
      ...Object.fromEntries(
        (availableCustomEvaluators.data ?? []).map((evaluator) => {
          const { inputs } = getInputsOutputs(
            JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl))
              ?.edges as Edge[],
            JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl))
              ?.nodes as JsonArray as unknown[] as Node[]
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
        })
      ),
    };
  }, [availableCustomEvaluators.data]);

  return availableEvaluators;
};
