import { type EvaluatorTypes } from "./evaluators.generated";
import { type EvaluatorDefinition } from "./evaluators.generated";
import { AVAILABLE_EVALUATORS } from "./evaluators.generated";
import { defaultEvaluatorInputSchema } from "./types";
import { type DataForEvaluation } from "~/server/background/workers/evaluationsWorker";
import { extractChunkTextualContent } from "~/server/background/workers/collector/evaluations";
import { getCustomEvaluators } from "~/server/background/workers/collector/evaluations";
import { getInputsOutputs } from "~/server/background/workers/collector/evaluations";
import { type Edge, type Node } from "~/server/background/workers/collector/evaluations";
import { type JsonArray } from "~/server/background/workers/collector/evaluations";

export const getEvaluatorDataForParams = (
  checkType: string,
  params: Record<string, any>
): DataForEvaluation => {
  if (checkType.startsWith("custom/")) {
    return {
      type: "custom",
      data: params,
    };
  }
  const data_ = defaultEvaluatorInputSchema.parse(params);
  const {
    input,
    output,
    contexts,
    expected_output,
    conversation,
    expected_contexts,
  } = data_;

  const contextList = contexts
    ?.map((context) => {
      if (typeof context === "string") {
        return context;
      } else {
        return extractChunkTextualContent(context.content);
      }
    })
    .filter((x) => x);

  const expectedContextList = expected_contexts
    ?.map((context) => {
      if (typeof context === "string") {
        return context;
      } else {
        return extractChunkTextualContent(context.content);
      }
    })
    .filter((x) => x);

  return {
    type: "default",
    data: {
      input: input ? input : undefined,
      output: output ? output : undefined,
      contexts: JSON.stringify(contextList),
      expected_output: expected_output ? expected_output : undefined,
      expected_contexts: JSON.stringify(expectedContextList),
      conversation: JSON.stringify(
        conversation?.map((message) => ({
          input: message.input ?? undefined,
          output: message.output ?? undefined,
        })) ?? []
      ),
    },
  };
};

export const getEvaluatorIncludingCustom = async (
  projectId: string,
  checkType: EvaluatorTypes
): Promise<
  EvaluatorDefinition<keyof typeof AVAILABLE_EVALUATORS> | undefined
> => {
  const availableCustomEvaluators = await getCustomEvaluators({
    projectId: projectId,
  });

  const availableEvaluators = {
    ...AVAILABLE_EVALUATORS,
    ...Object.fromEntries(
      (availableCustomEvaluators ?? []).map((evaluator) => {
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
            requiredFields: requiredFields,
          },
        ];
      })
    ),
  };

  return availableEvaluators[checkType];
};
