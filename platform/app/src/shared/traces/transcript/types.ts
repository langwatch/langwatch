import type { MediaPartData } from "~/shared/traces/mediaParts";

/**
 * The chat shapes a captured LLM payload can arrive in, normalised.
 *
 * This is the contract for every reader of a transcript: the trace drawer's
 * I/O panels, and the server-side extraction that hands the same messages to
 * an eval or an export. It lives under `shared/` because both sides parse the
 * identical payloads and must agree on what a message is.
 */
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
  | { kind: "media"; part: MediaPartData }
  | { kind: "raw"; data: unknown };

/**
 * A content block with the identity a comment can be left on. The key is
 * derived from what the block holds rather than from where it sits, so reading
 * the same transcript again recognises the same messages, and a message whose
 * content changed is a message nothing points at.
 */
export type KeyedContentBlock = ContentBlock & { blockKey: string };

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
