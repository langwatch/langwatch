/**
 * The scenario judge's chat call as a judge-leaf call and back: which phase it is from the tools
 * it offers, the criteria its verdict tool names, and the tool call it is answered with.
 * @see modules/scenario/specs/judge-preview.feature
 */

import {
  INSTANT_EVAL_SCENARIO_DECISION_TOOLS,
  INSTANT_EVAL_SCENARIO_VERDICT_TOOL,
  type InstantEvalScenarioCriterionResult,
  type InstantEvalScenarioJudgeAnswer,
  type InstantEvalScenarioJudgeCall,
  type InstantEvalScenarioJudgeTool,
} from "@langwatch/instant-eval-judge-contract";
import { LANGWATCH_JUDGE_MODEL_ID } from "@langwatch/model-provider-contract";
import {
  JudgePreviewRequestInvalidError,
  type JudgePreviewChatCompletion,
  type JudgePreviewChatRequest,
} from "@langwatch/scenario-contract";
import { z } from "zod";

const NOT_A_JUDGE_CALL = "LangWatch Judge (preview) judges scenario runs only.";
const STREAMING_REFUSED =
  "LangWatch Judge (preview) does not stream. Send the request without `stream`.";

type JudgePreviewLeafCall = Omit<InstantEvalScenarioJudgeCall, "projectId" | "signal">;

type ChatMessage = JudgePreviewChatRequest["messages"][number];

/** The judge's request as the leaf's call, or the 400 that says why it is not a judge call. */
export function judgePreviewLeafCallOf(request: JudgePreviewChatRequest): JudgePreviewLeafCall {
  if (request.stream === true) throw new JudgePreviewRequestInvalidError(STREAMING_REFUSED);
  const offered = (request.tools ?? []).map(leafToolOf);
  const verdictTool = offered.find((tool) => tool.name === INSTANT_EVAL_SCENARIO_VERDICT_TOOL);
  const decisionNames: readonly string[] = Object.values(INSTANT_EVAL_SCENARIO_DECISION_TOOLS);
  const decisionTools = offered.filter((tool) => decisionNames.includes(tool.name));
  const system = textOfRole({ messages: request.messages, isSystem: true });
  const user = textOfRole({ messages: request.messages, isSystem: false });
  const shared = { description: scenarioDescriptionOf(system), content: user };
  if (verdictTool) {
    return {
      phase: "verdict",
      ...shared,
      criteria: criteriaOf(verdictTool),
      llmCall: { system, user, tools: [verdictTool] },
    };
  }
  if (decisionTools.length === decisionNames.length) {
    return {
      phase: "decision",
      ...shared,
      criteria: [],
      llmCall: { system, user, tools: decisionTools },
    };
  }
  throw new JudgePreviewRequestInvalidError(NOT_A_JUDGE_CALL);
}

function leafToolOf(tool: NonNullable<JudgePreviewChatRequest["tools"]>[number]) {
  const { name, description = "", parameters = { type: "object", properties: {} } } = tool.function;
  return { name, description, parameters } satisfies InstantEvalScenarioJudgeTool;
}

/** Every system message, or every other message that carries text, joined in order. */
function textOfRole({
  messages,
  isSystem,
}: {
  messages: readonly ChatMessage[];
  isSystem: boolean;
}): string {
  return messages
    .filter((message) => (message.role === "system" || message.role === "developer") === isSystem)
    .map(textOf)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

function textOf({ content }: ChatMessage): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content.map((part) => part.text ?? "").join("");
}

const SCENARIO_BLOCK = /<scenario>\s*([\s\S]*?)\s*<\/scenario>/;

/** The judge's `<scenario>` block; a custom system prompt has none and is kept whole. */
function scenarioDescriptionOf(system: string): string {
  return SCENARIO_BLOCK.exec(system)?.[1] ?? system;
}

const verdictParametersSchema = z.object({
  properties: z.object({
    criteria: z.object({
      properties: z.record(z.string(), z.looseObject({ description: z.string().optional() })),
    }),
  }),
});

/** The criteria the verdict tool names: the key the judge reads back, and the criterion's text. */
function criteriaOf(tool: InstantEvalScenarioJudgeTool): InstantEvalScenarioJudgeCall["criteria"] {
  const parsed = verdictParametersSchema.safeParse(tool.parameters);
  if (!parsed.success) throw new JudgePreviewRequestInvalidError(NOT_A_JUDGE_CALL);
  return Object.entries(parsed.data.properties.criteria.properties).map(
    ([key, { description }]) => ({ key, text: description ?? key }),
  );
}

type JudgedAnswer = Extract<InstantEvalScenarioJudgeAnswer, { outcome: "judged" }>;

const CRITERION_ARGUMENT: Record<InstantEvalScenarioCriterionResult, string> = {
  met: "true",
  unmet: "false",
  inconclusive: "inconclusive",
};

/** The judged answer as the one tool call the scenario judge reads. */
export function judgePreviewChatCompletionOf({
  answer,
  call,
  id,
  createdAtSeconds,
}: {
  answer: JudgedAnswer;
  call: JudgePreviewLeafCall;
  id: string;
  createdAtSeconds: number;
}): JudgePreviewChatCompletion {
  const toolCall =
    answer.phase === "decision"
      ? { name: INSTANT_EVAL_SCENARIO_DECISION_TOOLS[answer.decision], arguments: {} }
      : {
          name: INSTANT_EVAL_SCENARIO_VERDICT_TOOL,
          arguments: verdictArgumentsOf({ answer, call }),
        };
  return {
    id,
    object: "chat.completion",
    created: createdAtSeconds,
    model: LANGWATCH_JUDGE_MODEL_ID,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${id}`,
              type: "function",
              function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
            },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: answer.inputTokens,
      completion_tokens: 0,
      total_tokens: answer.inputTokens,
    },
  };
}

/**
 * The verdict tool's arguments. The verdict fails on any unmet criterion, is inconclusive when
 * one could not be settled, and passes otherwise; the explanation never names what answered.
 */
function verdictArgumentsOf({
  answer,
  call,
}: {
  answer: Extract<JudgedAnswer, { phase: "verdict" }>;
  call: JudgePreviewLeafCall;
}) {
  const results = answer.criteria.map(({ result }) => result);
  return {
    criteria: Object.fromEntries(
      answer.criteria.map(({ key, result }) => [key, CRITERION_ARGUMENT[result]]),
    ),
    reasoning: answer.reasoning ?? summaryOf({ answer, call }),
    verdict: verdictOf(results),
  };
}

function verdictOf(results: readonly InstantEvalScenarioCriterionResult[]) {
  if (results.includes("unmet")) return "failure";
  return results.includes("inconclusive") ? "inconclusive" : "success";
}

const SUMMARY_LABELS: readonly (readonly [InstantEvalScenarioCriterionResult, string])[] = [
  ["met", "Met"],
  ["unmet", "Not met"],
  ["inconclusive", "Inconclusive"],
];

/** A plain list of the criteria by result, for a verdict no explanation came with. */
function summaryOf({
  answer,
  call,
}: {
  answer: Extract<JudgedAnswer, { phase: "verdict" }>;
  call: JudgePreviewLeafCall;
}): string {
  const textByKey = new Map(call.criteria.map(({ key, text }) => [key, text]));
  const lines = SUMMARY_LABELS.flatMap(([result, label]) => {
    const texts = answer.criteria
      .filter((criterion) => criterion.result === result)
      .map(({ key }) => textByKey.get(key) ?? key);
    return texts.length === 0 ? [] : [`${label}: ${texts.join("; ")}`];
  });
  return lines.length === 0 ? "No criteria were judged." : lines.join("\n");
}
