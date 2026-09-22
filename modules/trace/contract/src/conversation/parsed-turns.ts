import { collectAnnotatedMediaParts, type MediaPartData } from "../trace-media-part.collector.ts";
import {
  mediaRefBelongsToSide,
  mediaRefToMediaData,
  mediaRoleBelongsToSide,
  type TraceMediaRef,
  type TraceMediaSide,
} from "../trace-media-ref.ts";
import {
  extractReadableText,
  extractReasoningText,
} from "../transcript/transcript-text-extraction.ts";

/** Shared empty list so a media-free turn keeps a stable identity per parse. */
const NO_MEDIA: MediaPartData[] = [];

/**
 * What a conversation turn carries to be parsed and rendered. Structural on
 * purpose: the drawer passes a trace list item, the process half whatever the
 * trace read gave it, so naming only what the parse reads keeps out any UI type.
 */
export interface ConversationTurnSource {
  traceId: string;
  /** Epoch ms the turn started. */
  timestamp: number;
  durationMs: number;
  models: string[];
  totalCost?: number | null;
  totalTokens: number;
  input: string | null;
  output: string | null;
  inputRedacted?: boolean | null;
  outputRedacted?: boolean | null;
  inputMediaRefs?: TraceMediaRef[];
  outputMediaRefs?: TraceMediaRef[];
  error?: string;
}

export interface ParsedTurn<T extends ConversationTurnSource = ConversationTurnSource> {
  turn: T;
  userText: string;
  /**
   * Pre-extracted assistant prose for the bubble. Strips Anthropic-style
   * `{role:"assistant",content:[{type:"thinking"…},…]}` envelopes and pulls
   * just the text blocks, so raw JSON never reaches the bubble.
   */
  assistantText: string;
  assistantReasoning: string;
  /**
   * Media recorded on the turn's input side, rendered under the user message.
   * The caller's own media only: a reply recording that rode along in the
   * turn's input belongs to the assistant and is not repeated here.
   */
  userMedia: MediaPartData[];
  /** Media recorded on the turn's output side, rendered under the reply. */
  assistantMedia: MediaPartData[];
  /** Wall-clock seconds between the previous turn's end and this one's start. */
  gapSecs: number;
  shouldShowGap: boolean;
}

/** A gap shorter than this reads as the same exchange, so it is not drawn. */
const GAP_VISIBLE_AFTER_SECS = 5;

/**
 * The media that hangs off one side of a turn's messages: fold-derived
 * references where the turn has them, the walked payload where it does not,
 * and the summary strips' side rule either way.
 */
export function turnMediaForSide({
  refs,
  value,
  side,
}: {
  refs: TraceMediaRef[] | undefined;
  value: string | null | undefined;
  side: TraceMediaSide;
}): MediaPartData[] {
  if (refs && refs.length > 0) {
    const fromRefs = refs
      .filter((ref) => mediaRefBelongsToSide(ref, side))
      .map(mediaRefToMediaData);
    return fromRefs.length > 0 ? fromRefs : NO_MEDIA;
  }
  const collected = collectAnnotatedMediaParts(value)
    .filter((part) => mediaRoleBelongsToSide(part.role, side))
    .map((part) => part.media);
  return collected.length > 0 ? collected : NO_MEDIA;
}

/**
 * Parse a thread's turns once: the readable text, the reasoning, the media per
 * side, and the wall-clock gap to the previous turn. Without it each row
 * re-parses its whole payload on every render.
 */
export function buildParsedTurns<T extends ConversationTurnSource>({
  turns,
}: {
  turns: T[];
}): ParsedTurn<T>[] {
  const out: ParsedTurn<T>[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const previous = i > 0 ? turns[i - 1]! : undefined;
    const gapSecs = previous
      ? (turn.timestamp - (previous.timestamp + previous.durationMs)) / 1000
      : 0;
    out.push({
      turn,
      userText: extractReadableText(turn.input, "user"),
      assistantText: extractReadableText(turn.output, "assistant"),
      assistantReasoning: extractReasoningText(turn.output),
      userMedia: turnMediaForSide({
        refs: turn.inputMediaRefs,
        value: turn.input,
        side: "input",
      }),
      assistantMedia: turnMediaForSide({
        refs: turn.outputMediaRefs,
        value: turn.output,
        side: "output",
      }),
      gapSecs,
      shouldShowGap: gapSecs > GAP_VISIBLE_AFTER_SECS,
    });
  }
  return out;
}
