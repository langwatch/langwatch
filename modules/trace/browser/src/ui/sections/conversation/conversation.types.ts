import type { ParsedLLMError } from "@langwatch/prompt-contract";

import type { MediaPartData } from "../../../behavior/shared/traces/media-parts.ts";

// One renderable unit; tool calls and results pair into one part. Every
// surface flattens and renders through ConversationThread.
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
 * Consecutive parts that share a trace, presented as one exchange. Parts
 * with no trace (a streaming reply, a pre-tracing message) form their own
 * unnumbered turn, rendered without a separator rather than folded in.
 */
export interface ConversationTurn {
  key: string;
  traceId?: string;
  turnNumber?: number;
  parts: DisplayPart[];
}

/**
 * How the two sides of the thread are drawn. `scenario` swaps them, because a scenario run's `user`
 * messages come from a simulated user and its `assistant` messages from the agent under test. On a
 * voice run the caller was a person rather than a simulator, which reads as "You" (#8020).
 */
export type ConversationRoleMode = "chat" | "scenario" | "scenario-human-caller";

/**
 * Playback coordination for one audio part, as the host's sequential player
 * hands it out. Structural on purpose: the thread never starts a clip, it only
 * passes the props through to whatever draws the media.
 */
export interface ConversationAudioPlayback {
  ref: (element: HTMLAudioElement | null) => void;
  onPlay: () => void;
  onEnded: () => void;
}
