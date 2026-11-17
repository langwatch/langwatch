// Connects the OWASP pack to the agent under test. Wire callAgent and nothing else.
import scenario, {
  type AgentAdapter,
  type AgentInput,
  type AgentReturnTypes,
} from "@langwatch/scenario";

/** One message as the scenario passes it (AI SDK ModelMessage). */
export type ScenarioMessage = AgentInput["messages"][number];

/** One OpenAI chat completions message, as the `openai` SDK takes and returns it. */
export type OpenAIChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      refusal?: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Run your agent on the conversation so far and return its reply: a string,
 * one message, or the list of new messages. Return the tool call and tool
 * result messages too: the judge needs them to see tool use.
 */
export async function callAgent({
  messages,
}: {
  messages: AgentInput["messages"];
}): Promise<AgentReturnTypes> {
  // Agent on the `openai` SDK (chat completions):
  //   const newMessages = await runAgent(toOpenAIMessages({ messages }));
  //   return fromOpenAIMessages({ messages: newMessages });
  void messages;
  throw new Error("Wire your agent in agent-adapter.ts callAgent before running the OWASP pack");
}

export const owaspTargetAdapter: AgentAdapter = {
  role: scenario.AgentRole.AGENT,
  async call(input: AgentInput) {
    return await callAgent({ messages: input.messages });
  },
};

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text")
    .map((part) => part.text)
    .join("\n");
};

const outputText = (output: unknown): string => {
  if (output && typeof output === "object" && "value" in output) {
    const { value } = output as { value: unknown };
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  return typeof output === "string" ? output : JSON.stringify(output);
};

const toolCallsOf = (message: ScenarioMessage) =>
  (Array.isArray(message.content) ? message.content : []).flatMap((part) =>
    part.type === "tool-call"
      ? [
          {
            id: part.toolCallId,
            type: "function" as const,
            function: {
              name: part.toolName,
              // Arguments kept as a string (invalid JSON, a JSON string) travel back raw.
              arguments:
                typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {}),
            },
          },
        ]
      : [],
  );

const toOpenAI = (message: ScenarioMessage): OpenAIChatMessage[] => {
  if (message.role === "user") return [{ role: "user", content: textOf(message.content) }];
  if (message.role === "assistant") {
    const toolCalls = toolCallsOf(message);
    return [
      {
        role: "assistant",
        content: textOf(message.content),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    ];
  }
  if (message.role === "tool") {
    return message.content.flatMap((part) =>
      part.type === "tool-result"
        ? [
            {
              role: "tool" as const,
              tool_call_id: part.toolCallId,
              content: outputText(part.output),
            },
          ]
        : [],
    );
  }
  return [];
};

/**
 * Converts the scenario conversation to OpenAI chat messages. System messages
 * are dropped: the agent keeps its own system prompt.
 */
export function toOpenAIMessages({
  messages,
}: {
  messages: ScenarioMessage[];
}): OpenAIChatMessage[] {
  return messages.flatMap(toOpenAI);
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Invalid JSON (an empty string too) and JSON strings stay raw, so replay sends the same bytes.
const argumentsInput = (raw: string): unknown => {
  const parsed = parseJson(raw);
  return parsed === undefined || typeof parsed === "string" ? raw : parsed;
};

type OpenAIAssistantMessage = Extract<OpenAIChatMessage, { role: "assistant" }>;

const fromOpenAIAssistant = (message: OpenAIAssistantMessage): ScenarioMessage => {
  const calls = message.tool_calls ?? [];
  const text = message.content || message.refusal || "";
  return {
    role: "assistant",
    content: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...calls.map((call) => ({
        type: "tool-call" as const,
        toolCallId: call.id,
        toolName: call.function.name,
        input: argumentsInput(call.function.arguments),
      })),
    ],
  };
};

/** Converts the agent's new OpenAI chat messages back to scenario messages. */
export function fromOpenAIMessages({
  messages,
}: {
  messages: OpenAIChatMessage[];
}): ScenarioMessage[] {
  const toolNames = new Map<string, string>();
  const out: ScenarioMessage[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function.name);
      out.push(fromOpenAIAssistant(message));
    } else if (message.role === "tool") {
      const json = parseJson(message.content);
      out.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.tool_call_id,
            toolName: toolNames.get(message.tool_call_id) ?? "unknown",
            output:
              json !== undefined && typeof json === "object"
                ? { type: "json", value: json as never }
                : { type: "text", value: message.content },
          },
        ],
      });
    }
  }
  return out;
}
