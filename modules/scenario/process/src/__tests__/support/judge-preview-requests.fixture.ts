import type { JudgePreviewChatRequest } from "@langwatch/scenario-contract";

import sdkVerdictRequest from "./scenario-sdk-verdict-request.json" with { type: "json" };

/**
 * The scenario judge's two calls as its OpenAI-compatible client sends them, made-up criteria.
 * The verdict call is what `@langwatch/scenario` 1.8.1's JudgeAgent sent on the runner's judge
 * model (scenario-sdk-verdict-request.json); apps/scenario-child's client test pins it to the SDK.
 */
const [SDK_SYSTEM, SDK_USER] = sdkVerdictRequest.messages;

const VERDICT_SYSTEM = SDK_SYSTEM!.content;

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

/** The SDK's finish_test, as sent: strict, one `{ requirement, reasoning, status }` per key. */
const FINISH_TEST = sdkVerdictRequest.tools[0]! as NonNullable<
  JudgePreviewChatRequest["tools"]
>[number];

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
      { role: "user", content: SDK_USER!.content },
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
