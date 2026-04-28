export interface ChatMessage {
  role: string;
  content: string | null | Array<Record<string, unknown> | string>;
  tool_calls?: Array<{
    function: { name: string; arguments: string };
    id: string;
    type: string;
  }>;
  // OpenAI o-series reasoning models surface chain-of-thought here. Anthropic
  // uses `thinking`. Treat both as the same "reasoning" concept.
  reasoning_content?: string | null;
  thinking?: string | null;
  name?: string;
  tool_call_id?: string;
}

/**
 * Anthropic-style typed content blocks. A single message's `content` can be
 * a heterogenous array of text / thinking / tool_use / tool_result, all
 * mixed together. We render each block with its own dedicated UI so the
 * thinking and tool calls don't end up dumped as raw JSON in the body.
 */
export type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool_use";
      id?: string;
      name: string;
      input: unknown;
    }
  | {
      kind: "tool_result";
      toolUseId?: string;
      content: unknown;
      isError?: boolean;
    }
  | { kind: "raw"; data: unknown };

export type ConversationTurn =
  | {
      kind: "user";
      blocks: ContentBlock[];
      toolCalls: NonNullable<ChatMessage["tool_calls"]>;
      messages: ChatMessage[];
    }
  | {
      kind: "assistant";
      blocks: ContentBlock[];
      toolCalls: NonNullable<ChatMessage["tool_calls"]>;
      messages: ChatMessage[];
    }
  | {
      kind: "system";
      role: "system" | "developer";
      blocks: ContentBlock[];
      messages: ChatMessage[];
    };

export type ChatLayout = "thread" | "bubbles";
export const VIRTUALIZE_AT = 20;

/**
 * Above this turn count we collapse everything except the last turn by
 * default — short convos still benefit from showing the last couple
 * expanded; long convos drown the user in collapsed noise unless we're
 * aggressive about hiding.
 */
export const LONG_THREAD_THRESHOLD = 6;
