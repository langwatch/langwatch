/**
 * What one reported DSPy step becomes before it is stored: its examples
 * hashed, its LLM calls priced against the project's own cost rules, and the
 * largest of them truncated so storing a step never costs more than reading it
 * is worth.
 */
import {
  type DSPyLLMCall,
  type DSPyStepRESTParams,
  type ExperimentDspyStep,
} from "@langwatch/experiment-contract";
import {
  estimateCost,
  matchModelCost,
  type ModelCostRate,
} from "@langwatch/model-provider-contract";
import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * A step whose `llm_calls` are large enough that storing them whole would cost
 * more than reading them is worth. The response text is dropped past this.
 */
const MAX_LLM_CALL_BYTES = 256_000;

/** One reported step, ready to store. */
export function dspyStepOf(input: {
  tenantId: string;
  experimentId: string;
  param: DSPyStepRESTParams;
  costs: readonly ModelCostRate[];
  now: number;
}): ExperimentDspyStep {
  const { tenantId, experimentId, param, costs, now } = input;

  const examples = param.examples.map((example) => ({
    ...example,
    trace: example.trace?.map((entry) => {
      if (entry.input?.contexts && typeof entry.input.contexts !== "string") {
        entry.input.contexts = JSON.stringify(entry.input.contexts);
      }

      return entry;
    }),
    hash: hashOf(example),
  }));

  const llmCalls = param.llm_calls
    .map((call) => ({ ...call, hash: hashOf(call) }))
    .map((call) => priceLlmCall(call, costs))
    .map((llmCall) => {
      if (llmCall.response?.output) {
        delete llmCall.response.choices;
      }
      if (llmCall.response && JSON.stringify(llmCall).length >= MAX_LLM_CALL_BYTES) {
        llmCall.response.output = "[truncated]";
        llmCall.response.messages = [];
      }

      return llmCall;
    });

  return {
    tenantId,
    experimentId,
    runId: param.run_id,
    stepIndex: param.index,
    workflowVersionId: param.workflow_version_id,
    score: param.score,
    label: param.label,
    optimizerName: param.optimizer.name,
    optimizerParameters: param.optimizer.parameters,
    predictors: param.predictors,
    examples,
    llmCalls,
    createdAt: param.timestamps.created_at,
    insertedAt: now,
    updatedAt: now,
  };
}

const hashOf = (data: object): string =>
  createHash("md5").update(JSON.stringify(data)).digest("hex");

/**
 * A DSPy LLM call's `response` is a JSON dump of an arbitrary Python object,
 * so the contract types it as an opaque record. Cost accounting reads only
 * the OpenAI chat-completion fields below through this schema.
 */
const llmCallCostFieldsSchema = z.object({
  model: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

function priceLlmCall(call: DSPyLLMCall, costs: readonly ModelCostRate[]): DSPyLLMCall {
  if (call.__class__ !== "dsp.modules.gpt3.GPT3" && call.response?.object !== "chat.completion") {
    return call;
  }
  const fields = llmCallCostFieldsSchema.safeParse(call.response);
  const costFields = fields.success ? fields.data : undefined;
  const model = costFields?.model;
  const rate = model ? matchModelCost(model, costs) : undefined;
  const promptTokens = costFields?.usage?.prompt_tokens;
  const completionTokens = costFields?.usage?.completion_tokens;
  return {
    ...call,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cost: rate
      ? estimateCost({
          rate,
          inputTokens: promptTokens ?? 0,
          outputTokens: completionTokens ?? 0,
          // A DSPy dump carries neither cached nor audio usage, so the four
          // remaining dimensions are zero rather than absent: the cascade
          // reads them unconditionally and an omitted one would be `NaN`.
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheCreation1hTokens: 0,
          inputAudioTokens: 0,
          outputAudioTokens: 0,
        })
      : undefined,
  };
}
