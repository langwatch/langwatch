import {
  mediaRefBelongsToSide,
  mediaRoleBelongsToSide,
  type TraceMediaRef,
  type TraceMediaSide,
} from "~/shared/traces/media-refs";
import {
  collectAnnotatedMediaParts,
  type MediaPartData,
  mediaRefToMediaData,
} from "~/shared/traces/mediaParts";
import {
  extractReadableText,
  extractReasoningText,
} from "~/shared/traces/transcript/parsing";

/** Shared empty list so a media-free turn keeps a stable identity per parse. */
const NO_MEDIA: MediaPartData[] = [];

/**
 * What a conversation turn needs to carry to be parsed and rendered.
 *
 * Structural on purpose: the drawer passes a full `TraceListItem`, the server
 * passes whatever the trace list read gave it. Naming only the fields the
 * parse reads keeps this module free of any UI type, and says exactly what a
 * server-side caller has to provide. The field names are therefore the ones
 * the trace summary and the conversation-context payload already carry, which
 * is why the two redaction flags read as nouns.
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

export interface ParsedTurn<
  T extends ConversationTurnSource = ConversationTurnSource,
> {
  turn: T;
  userText: string;
  /**
   * Pre-extracted assistant prose for the bubble. Strips Anthropic-style
   * `{role:"assistant",content:[{type:"thinking"…},…]}` envelopes and
   * pulls just the text blocks, so we don't dump raw JSON in the bubble.
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
 * The media that hangs off one side of a turn's messages.
 *
 * Two sources, in the order the trace table already reads them. A turn's
 * input and output text is flattened at fold time, so the fold-derived
 * references are the only record of what the winning span payload carried and
 * they win whenever they exist. A turn handed over with its raw payload (a
 * threadless trace the host fetched itself) has no references, so its value
 * is walked for parts instead.
 *
 * Either way the same side rule applies as on the summary strips: the caller's
 * media stays on the input side, the agent's reply on the output side, and
 * media recorded without a role stays wherever it was recorded.
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
 * Parse a thread's turns once: the readable user and assistant text, the
 * reasoning, the media per side, and the wall-clock gap to the previous turn.
 *
 * One pass over the whole thread, because every consumer needs the same
 * parse. Without it each rendered row would re-JSON.parse its entire payload
 * on every re-render, and a server-side reader would parse the thread once per
 * question asked of it.
 */
export function buildParsedTurns<T extends ConversationTurnSource>({
  turns,
}: {
  turns: T[];
}): ParsedTurn<T>[] {
  const out: ParsedTurn<T>[] = new Array(turns.length);
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const previous = i > 0 ? turns[i - 1]! : undefined;
    const gapSecs = previous
      ? (turn.timestamp - (previous.timestamp + previous.durationMs)) / 1000
      : 0;
    out[i] = {
      turn,
      // Use the shared transcript helpers so we handle the same shapes the
      // I/O viewer does (chat arrays, single message objects, typed-block
      // content arrays, and the raw-string fallback).
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
    };
  }
  return out;
}
