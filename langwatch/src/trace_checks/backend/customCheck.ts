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
        rulePassed = llmBoolResult === true;
        score = llmBoolResult;
        break;
      case "llm_score":
        const llmScoreResult = await handleLLMCheck(
          rule,
          trace.input.value,
          rule.field === "output" ? trace.output?.value : undefined
        );
        rulePassed =
          typeof llmScoreResult === "number" &&
          !matchesFailWhenCondition(llmScoreResult, rule.failWhen);
        score = llmScoreResult;
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
): Promise<boolean | number | undefined> {
  const openai = new OpenAI();
  const outputPart = output ? `# Output:\n\n${output}\n\n\n` : "";
  const chatCompletion = await openai.chat.completions.create({
    messages: [
      {
        role: "user",
        content: `# Input:\n\n${input}\n\n\n${outputPart}# Task\n\n${rule.value}\n\n`,
      },
    ],
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

  if (rule.rule === "llm_boolean") {
    return args.result;
  } else {
    return args.score;
  }
}

export const CustomCheck: TraceCheckBackendDefinition<"custom"> = {
  execute,
};
