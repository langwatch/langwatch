/**
 * Split an assistant message's parts into the ordered render sequence the
 * block channel needs (ADR-060 §1): prose stays prose, a stamped
 * `langy-card` part renders as its card WHERE THE BLOCK SAT in the reply's
 * flow, and a `langy-card-failed` part renders as the disclosure.
 *
 * This reads the parts the relay recorded — it never re-parses fences out of
 * text. A text part that happens to CONTAIN a ```langy-card fence renders as
 * text (the browser renders the stamped part, never its own parse; a fence
 * that reached the client as text is a fence the relay decided was not a
 * block — quoted inside a code example, or from a turn recorded before the
 * channel existed).
 *
 * A part claiming `type: "langy-card"` that does not parse against the
 * shared contract degrades to a FAILED segment carrying its JSON — a
 * malformed stamp must never vanish quieter than a failed block would.
 */
import {
  LANGY_CARD_FAILED_PART_TYPE,
  LANGY_CARD_PART_TYPE,
  type LangyCardFailedPart,
  type LangyCardPart,
  mightContainLangyCardFence,
  parseLangyCardFailedPart,
  parseLangyCardPart,
  salvageLangyDerivedCard,
  splitLangyCardFences,
} from "@langwatch/langy";

export type LangyAnswerSegment =
  | { type: "text"; text: string }
  | { type: "card"; part: LangyCardPart }
  | { type: "failed"; part: LangyCardFailedPart };

interface PartLike {
  type?: string;
  text?: string;
}

/** True when any part is a block part — the gate for segment rendering. */
export function hasLangyBlockParts(parts: readonly unknown[]): boolean {
  return parts.some((part) => {
    const type = (part as PartLike).type;
    return (
      type === LANGY_CARD_PART_TYPE || type === LANGY_CARD_FAILED_PART_TYPE
    );
  });
}

/**
 * The ordered segments. Consecutive text parts merge into one prose run with
 * a paragraph break at each part boundary — distinct parts are distinct
 * blocks, and a bare join glued the last word of one part onto the first
 * word of the next. Empty text segments are dropped.
 */
export function langyAnswerSegments(
  parts: readonly unknown[],
): LangyAnswerSegment[] {
  const segments: LangyAnswerSegment[] = [];
  let textBuffer: string[] = [];

  const flushText = (): void => {
    if (textBuffer.length === 0) return;
    const text = textBuffer.join("\n\n");
    textBuffer = [];
    if (text.trim().length === 0) return;
    segments.push({ type: "text", text });
  };

  for (const rawPart of parts) {
    const part = rawPart as PartLike;
    if (part.type === "text") {
      if ((part.text ?? "").length > 0) textBuffer.push(part.text ?? "");
      continue;
    }
    if (part.type === LANGY_CARD_PART_TYPE) {
      flushText();
      const parsed = parseLangyCardPart(rawPart);
      if (parsed) {
        segments.push({ type: "card", part: parsed });
      } else {
        // A malformed stamp still surfaces — as the disclosure, with the
        // part itself as the raw evidence.
        segments.push({
          type: "failed",
          part: {
            type: "langy-card-failed",
            blockId: "malformed-part",
            raw: safeStringify(rawPart),
          },
        });
      }
      continue;
    }
    if (part.type === LANGY_CARD_FAILED_PART_TYPE) {
      flushText();
      const parsed = parseLangyCardFailedPart(rawPart);
      if (parsed) segments.push({ type: "failed", part: parsed });
      continue;
    }
    // Tool parts and anything else render through their own surfaces
    // (LangyToolActivity et al) — not part of the prose flow.
  }
  flushText();
  return segments;
}

/**
 * The same ordered segments for a message the relay never stamped FOR THIS
 * CLIENT: the copy the panel streamed for itself.
 *
 * A turn the reader watched leaves two copies of its reply. The durable record
 * carries the parts the relay stamped out of the fences; the streamed copy in
 * the chat engine carries the fences as text and is never replaced by the
 * durable one (replacing it would drop the mid-turn narration, which the saved
 * reply does not keep). So the reader who watched the turn was the only reader
 * who saw the reply's closing cards as JSON in a code block, and a page reload
 * drew them properly.
 *
 * Reading those fences here is not the browser second-guessing the relay. It
 * is the SAME scanner and the SAME salvage the stamp uses, so it can only
 * reach the verdict the stamp reached: a fence quoted inside another code block
 * stays opaque text on both sides. Returns null when the text holds no fence,
 * so an ordinary reply keeps the plain markdown path.
 */
export function langyAnswerSegmentsFromText(
  text: string,
): LangyAnswerSegment[] | null {
  if (!mightContainLangyCardFence(text)) return null;
  const fenced = splitLangyCardFences(text);
  if (!fenced.some((segment) => segment.type === "fence")) return null;

  let ordinal = 0;
  return fenced.flatMap((segment): LangyAnswerSegment[] => {
    if (segment.type === "text") {
      return segment.text.trim().length > 0
        ? [{ type: "text", text: segment.text }]
        : [];
    }
    ordinal += 1;
    return [fenceSegment({ raw: segment.raw, ordinal })];
  });
}

/** One fence's verdict, by the same salvage the relay stamps with. */
function fenceSegment({
  raw,
  ordinal,
}: {
  raw: string;
  ordinal: number;
}): LangyAnswerSegment {
  const parsed = salvageLangyDerivedCard(raw);
  if (!parsed.ok) {
    return {
      type: "failed",
      part: {
        type: LANGY_CARD_FAILED_PART_TYPE,
        blockId: `failed-block-${ordinal}`,
        raw,
      },
    };
  }
  return {
    type: "card",
    part: {
      type: LANGY_CARD_PART_TYPE,
      blockId: parsed.card.blockId,
      kind: parsed.card.kind,
      provenance: "derived",
      card: parsed.card,
      ...(parsed.card.hints !== undefined ? { hints: parsed.card.hints } : {}),
    },
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
