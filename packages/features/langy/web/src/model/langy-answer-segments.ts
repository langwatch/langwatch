/**
 * Split an assistant message's parts into the ordered render sequence the block channel needs (ADR-060 §1): prose
 * stays prose, a stamped `langy-card` part renders as its card WHERE THE BLOCK SAT in the reply's flow, and a
 * `langy-card-failed` part renders as the disclosure.
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
} from "@langwatch/langy-contract";
import { z } from "zod";

export type LangyAnswerSegment =
  | { type: "text"; text: string }
  | { type: "card"; part: LangyCardPart }
  | { type: "failed"; part: LangyCardFailedPart };

const answerPartSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
  })
  .loose();

/** True when any part is a block part — the gate for segment rendering. */
export function hasLangyBlockParts(parts: readonly unknown[]): boolean {
  return parts.some((part) => {
    const parsed = answerPartSchema.safeParse(part);
    if (!parsed.success) return false;

    const { type } = parsed.data;
    return type === LANGY_CARD_PART_TYPE || type === LANGY_CARD_FAILED_PART_TYPE;
  });
}

/**
 * The ordered segments. Consecutive text parts merge into one prose run with a
 * paragraph break at each part boundary — distinct parts are distinct blocks, and a
 * bare join glued the last word of one part onto the first word of the next.
 */
export function langyAnswerSegments(parts: readonly unknown[]): LangyAnswerSegment[] {
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
    const parsedPart = answerPartSchema.safeParse(rawPart);
    if (!parsedPart.success) continue;

    const part = parsedPart.data;
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
 * The same ordered segments for a message the relay never stamped FOR THIS CLIENT: the
 * copy the panel streamed for itself.
 */
export function langyAnswerSegmentsFromText(text: string): LangyAnswerSegment[] | null {
  if (!mightContainLangyCardFence(text)) return null;
  const fenced = splitLangyCardFences(text);
  if (!fenced.some((segment) => segment.type === "fence")) return null;

  let ordinal = 0;
  return fenced.flatMap((segment): LangyAnswerSegment[] => {
    if (segment.type === "text") {
      return segment.text.trim().length > 0 ? [{ type: "text", text: segment.text }] : [];
    }
    ordinal += 1;
    return [fenceSegment({ raw: segment.raw, ordinal })];
  });
}

/** One fence's verdict, by the same salvage the relay stamps with. */
function fenceSegment({ raw, ordinal }: { raw: string; ordinal: number }): LangyAnswerSegment {
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
