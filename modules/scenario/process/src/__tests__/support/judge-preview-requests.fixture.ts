import type { JudgePreviewChatRequest } from "@langwatch/scenario-contract";

/**
 * The scenario judge's two calls as its OpenAI-compatible client sends them: the prompts and the
 * tool shapes of `@langwatch/scenario`'s JudgeAgent, with made-up criteria.
 */
const VERDICT_SYSTEM = `<role>
You are an LLM as a judge delivering the final verdict on a simulated conversation, determining if the agent under test meets the criteria or not.
</role>

<goal>
Your goal is to deliver the final verdict of the scenario below with the finish_test tool, evaluating each criterion independently against the conversation and the collected evidence.
</goal>

<scenario>
A customer asks for a refund on a late order
</scenario>

<criteria>
1. The agent offers a refund
2. The agent apologises
</criteria>`;

const DECISION_SYSTEM = `<role>
You are an LLM as a judge watching a simulated conversation as it plays out live to decide if it has collected enough information to evaluate the agent under test.
</role>

<scenario>
A customer asks for a refund on a late order
</scenario>`;

const JUDGE_CONTENT = `
    <transcript>
    user: my order is late
    assistant: I refunded it
    </transcript>
    <opentelemetry_traces>
    No traces available
    </opentelemetry_traces>
    `;

const criterion = (description: string) => ({
  type: "string",
  enum: ["true", "false", "inconclusive"],
  description,
});

const FINISH_TEST = {
  type: "function" as const,
  function: {
    name: "finish_test",
    description: "Complete the test with a final verdict",
    parameters: {
      type: "object",
      properties: {
        criteria: {
          type: "object",
          properties: {
            the_agent_offers_a_refund: criterion("The agent offers a refund"),
            the_agent_apologises: criterion("The agent apologises"),
          },
          required: ["the_agent_offers_a_refund", "the_agent_apologises"],
          additionalProperties: false,
          description: "Strict verdict for each criterion",
        },
        reasoning: {
          type: "string",
          description: "Explanation of what the final verdict should be",
        },
        verdict: {
          type: "string",
          enum: ["success", "failure", "inconclusive"],
          description: "The final verdict of the test",
        },
      },
      required: ["criteria", "reasoning", "verdict"],
      additionalProperties: false,
    },
  },
};

const emptyTool = (name: string, description: string) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
});

export function verdictRequest({
  system = VERDICT_SYSTEM,
  extraTools = [],
}: { system?: string; extraTools?: readonly string[] } = {}): JudgePreviewChatRequest {
  return {
    model: "langwatch-judge-preview",
    messages: [
      { role: "system", content: system },
      { role: "user", content: JUDGE_CONTENT },
    ],
    tools: [...extraTools.map((name) => emptyTool(name, "A trace tool")), FINISH_TEST],
    tool_choice: { type: "function", function: { name: "finish_test" } },
  };
}

export function decisionRequest({
  extraTools = [],
}: { extraTools?: readonly string[] } = {}): JudgePreviewChatRequest {
  return {
    model: "langwatch-judge-preview",
    messages: [
      { role: "system", content: DECISION_SYSTEM },
      { role: "user", content: JUDGE_CONTENT },
    ],
    tools: [
      ...extraTools.map((name) => emptyTool(name, "A trace tool")),
      emptyTool("continue_test", "Continue the test with the next step"),
      emptyTool("make_verdict", "End the conversation and move to the verdict."),
    ],
    tool_choice: "required",
  };
}
