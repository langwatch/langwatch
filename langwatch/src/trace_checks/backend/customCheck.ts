import similarity from "compute-cosine-similarity";
import OpenAI from "openai";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type {
  Checks,
  CustomCheckFailWhen,
  CustomCheckRule,
  TraceCheckBackendDefinition,
  TraceCheckResult,
} from "../types";
import { estimateCost, tokenizeAndEstimateCost } from "llm-cost";
import type { ChatCompletionMessageParam } from "openai/resources";
import type { Money } from "../../utils/types";

const execute = async (
  trace: Trace,
  _spans: ElasticSearchSpan[],
  parameters: Checks["custom"]["parameters"]
): Promise<TraceCheckResult> => {
  const results = [];
  const failedRules: {
    rule: CustomCheckRule;
    score: number | boolean | undefined;
  }[] = [];
  const costs: { [K in Money["currency"]]: { amount: number; currency: K } } = {
    USD: { amount: 0.0, currency: "USD" },
    EUR: { amount: 0.0, currency: "EUR" },
  };
  for (const rule of parameters.rules) {
    const valueToCheck =
      (rule.field === "input" ? trace.input.value : trace.output?.value) ?? "";

    let rulePassed = false;
    let score = undefined;
    switch (rule.rule) {
      case "contains":
        rulePassed = valueToCheck
          .toLowerCase()
          .includes(rule.value.toLowerCase());
        break;
      case "not_contains":
        rulePassed = !valueToCheck
          .toLowerCase()
          .includes(rule.value.toLowerCase());
        break;
      case "matches_regex":
        try {
          const regex = new RegExp(rule.value, "gi");
          rulePassed = regex.test(valueToCheck);
        } catch (error) {
          throw new Error(`Invalid regex: ${rule.value}`);
        }
        break;
      case "not_matches_regex":
        try {
          const regex = new RegExp(rule.value, "gi");
          rulePassed = !regex.test(valueToCheck);
        } catch (error) {
          throw new Error(`Invalid regex: ${rule.value}`);
        }
        break;
      case "is_similar_to":
        const embeddings = rule.openai_embeddings ?? [];
        if (embeddings.length === 0) {
          throw new Error("No embeddings provided for is_similar_to rule.");
        }
        const traceEmbeddings = trace.search_embeddings.openai_embeddings;
        if (!traceEmbeddings) {
          throw new Error(
            "No embeddings found in trace for is_similar_to rule."
          );
        }
        const similarityScore = similarity(embeddings, traceEmbeddings);
        if (!similarityScore) {
          throw new Error("Error computing similarity.");
        }
        rulePassed = !matchesFailWhenCondition(similarityScore, rule.failWhen);
        score = similarityScore;
        break;
      case "llm_boolean":
        const llmBoolResult = await handleLLMCheck(
          rule,
          trace.input.value,
          rule.field === "output" ? trace.output?.value : undefined
        );
        rulePassed = llmBoolResult.result === true;
        score = llmBoolResult.result;
        costs[llmBoolResult.cost.currency].amount += llmBoolResult.cost.amount;

        break;
      case "llm_score":
        const llmScoreResult = await handleLLMCheck(
          rule,
          trace.input.value,
          rule.field === "output" ? trace.output?.value : undefined
        );
        rulePassed =
          typeof llmScoreResult.result === "number" &&
          !matchesFailWhenCondition(llmScoreResult.result, rule.failWhen);
        score = llmScoreResult.result;
        costs[llmScoreResult.cost.currency].amount += llmScoreResult.cost.amount;

        break;
    }

    if ("openai_embeddings" in rule) {
      delete rule.openai_embeddings;
    }
    if (!rulePassed) {
      failedRules.push({ rule, score });
    }
    results.push({ rule, passed: rulePassed });
  }
  return {
    raw_result: { results, failedRules },
    value: failedRules.length,
    status: failedRules.length > 0 ? "failed" : "succeeded",
    costs: Object.values(costs).filter((cost) => cost.amount > 0),
  };
};

const matchesFailWhenCondition = (
  score: number,
  failWhen: CustomCheckFailWhen
): boolean => {
  switch (failWhen.condition) {
    case "<":
      return score < failWhen.amount;
    case ">":
      return score > failWhen.amount;
    case "<=":
      return score <= failWhen.amount;
    case ">=":
      return score >= failWhen.amount;
    case "==":
      return score === failWhen.amount;
    default:
      throw new Error(
        `Invalid failWhen condition: ${failWhen.condition as any}`
      );
  }
};

async function handleLLMCheck(
  rule: CustomCheckRule,
  input: string,
  output?: string
): Promise<{ result: boolean | number | undefined; cost: Money }> {
  const openai = new OpenAI();
  const outputPart = output ? `# Output:\n\n${output}\n\n\n` : "";

  const messages: Array<ChatCompletionMessageParam> = [
    {
      role: "user",
      content: `# Input:\n\n${input}\n\n\n${outputPart}# Task\n\n${rule.value}\n\n`,
    },
  ];
  const chatCompletion = await openai.chat.completions.create({
    messages,
    model: (rule as any).model ?? "gpt-3.5-turbo",
    temperature: 0.0,
    tool_choice: {
      type: "function",
      function: {
        name: rule.rule === "llm_boolean" ? "booleanReply" : "scoreReply",
      },
    },
    tools: [
      {
        type: "function",
        function:
          rule.rule === "llm_boolean"
            ? {
                name: "booleanReply",
                parameters: {
                  type: "object",
                  properties: {
                    result: { type: "boolean" },
                  },
                },
                description: "use this function to reply with true or false",
              }
            : {
                name: "scoreReply",
                parameters: {
                  type: "object",
                  properties: {
                    score: { type: "number" },
                  },
                },
                description: "use this function to return a score",
              },
      },
    ],
  });

  const args = JSON.parse(
    chatCompletion.choices[0]?.message.tool_calls?.[0]?.function.arguments ??
      "{}"
  );

  const usage = chatCompletion.usage;
  const cost = usage
    ? estimateCost({
        model: chatCompletion.model,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
      })
    : (
        await tokenizeAndEstimateCost({
          model: chatCompletion.model,
          input: JSON.stringify(messages),
          output: JSON.stringify(chatCompletion.choices[0]),
        })
      ).cost;

  if (rule.rule === "llm_boolean") {
    return { result: args.result, cost: { amount: cost ?? 0, currency: "USD" } };
  } else {
    return { result: args.score, cost: { amount: cost ?? 0, currency: "USD" } };
  }
}

export const CustomCheck: TraceCheckBackendDefinition<"custom"> = {
  execute,
};
