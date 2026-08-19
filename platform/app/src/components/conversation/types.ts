import type { MediaPartData } from "~/shared/traces/mediaParts";
import type { ParsedLLMError } from "~/utils/formatLLMError";

/**
 * One renderable unit of a conversation.
 *
 * Every surface that shows a chat transcript — the prompt playground, the
 * simulations grid and drawer, and anything that follows — flattens its raw
 * messages into this union and renders it through `ConversationThread`. A new
 * content shape is taught to `flattenMessages` once, and every surface gets it.
 *
 * A tool call and the result that answers it are ONE part, not two: that is
 * what `ToolPairCard` renders, and it is what a reader is actually looking at.
 * The pairing happens in the flattener, where both halves are in scope.
 */
export type DisplayPart =
  | {
      kind: "text";
      id: string;
      role: string;
      content: string;
      /**
       * Chain-of-thought the model emitted alongside this reply
       * (`reasoning_content` on OpenAI o-series, `thinking` on Anthropic).
       * Rendered above the reply, inside the same bubble.
       */
      reasoning?: string;
      traceId?: string;
    }
  | {
      kind: "image";
      id: string;
      src: string;
      role?: string;
      traceId?: string;
    }
  | {
      kind: "media";
      id: string;
      part: MediaPartData;
      role?: string;
      /**
       * Set when the message carried an audio part and a sibling text part —
       * the OpenAI Realtime convention for "here is what was said".
       */
      transcript?: string;
      traceId?: string;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      arguments: unknown;
      /** Wire id used to pair a result back to this call. Absent on some SDKs. */
      toolCallId?: string;
      /** Absent while the call is still outstanding. */
      result?: { content: unknown; isError?: boolean };
      traceId?: string;
    }
  | {
      /**
       * A turn that failed instead of answering. Part of the transcript rather
       * than a banner beside it: the failure happened at a point in the
       * conversation, and reading it anywhere else loses that.
       */
      kind: "error";
      id: string;
      error: ParsedLLMError;
      traceId?: string;
    };

/**
 * Consecutive parts that share a trace, presented as one exchange.
 *
 * Parts with no trace (a reply still streaming, a message that predates
 * tracing) form their own unnumbered turn so they render without a separator
 * rather than being folded into the previous one.
 */
export interface ConversationTurn {
  key: string;
  traceId?: string;
  turnNumber?: number;
  parts: DisplayPart[];
}
