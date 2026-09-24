/**
 * langy-card fence scanner (ADR-060 §1): opens on ```langy-card, closes on
 * untagged fence. Other fenced blocks opaque (nested). Relay and preview share
 * this module so scanning is never ambiguous.
 */

/** The fence info tag that marks a card Langy wrote. */
export const LANGY_CARD_FENCE_TAG = "langy-card";

export type LangyCardFenceSegment =
  | { type: "text"; text: string }
  | {
      type: "fence";
      /** The raw content between the fence lines (candidate JSON). */
      raw: string;
      /** False when the stream ended before the closing fence arrived. */
      closed: boolean;
    };

/**
 * Conservative check for tag presence. Avoids line scan on fence-less streams.
 * Belongs here not at call site (tag test alone misses space/indent variants).
 */
export function mightContainLangyCardFence(text: string): boolean {
  return text.includes(LANGY_CARD_FENCE_TAG);
}

/** `["```", "langy-card"]` for a fence line, or null. */
function parseFenceLine(line: string): { ticks: number; tag: string } | null {
  const match = /^ {0,3}(`{3,})([^`]*)$/.exec(line);
  if (!match) return null;
  return { ticks: match[1]!.length, tag: match[2]!.trim() };
}

/**
 * Split text into prose and langy-card fences, in document order. Text
 * segments are verbatim (including other code fences); the langy-card
 * fence lines are consumed. Adjacent text is merged, empty segments dropped.
 */
export function splitLangyCardFences(text: string): LangyCardFenceSegment[] {
  const segments: LangyCardFenceSegment[] = [];
  const lines = text.split("\n");

  let textLines: string[] = [];
  let fenceLines: string[] | null = null;
  /** Inside a NON-langy-card fenced block: its content is opaque text. */
  let opaqueFenceTicks: number | null = null;

  const flushText = (): void => {
    if (textLines.length === 0) return;
    const joined = textLines.join("\n");
    textLines = [];
    if (joined.length === 0) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.type === "text") {
      segments[segments.length - 1] = {
        type: "text",
        text: `${previous.text}\n${joined}`,
      };
      return;
    }
    segments.push({ type: "text", text: joined });
  };

  for (const line of lines) {
    const fence = parseFenceLine(line);

    if (fenceLines !== null) {
      // Inside a langy-card fence: only an untagged closing fence ends it.
      if (fence && fence.tag === "") {
        segments.push({
          type: "fence",
          raw: fenceLines.join("\n"),
          closed: true,
        });
        fenceLines = null;
        continue;
      }
      fenceLines.push(line);
      continue;
    }

    if (opaqueFenceTicks !== null) {
      // Inside some other code block: everything is literal text, and only
      // a closing fence with at least as many backticks ends it.
      textLines.push(line);
      if (fence && fence.tag === "" && fence.ticks >= opaqueFenceTicks) {
        opaqueFenceTicks = null;
      }
      continue;
    }

    if (fence) {
      if (fence.tag === LANGY_CARD_FENCE_TAG) {
        flushText();
        fenceLines = [];
        continue;
      }
      if (fence.tag !== "") {
        // An ordinary tagged code fence opens an opaque block.
        opaqueFenceTicks = fence.ticks;
      }
      // A bare ``` outside any fence is literal text (a stray close).
    }
    textLines.push(line);
  }

  if (fenceLines !== null) {
    // Stream ended inside a langy-card fence: report it unclosed.
    segments.push({
      type: "fence",
      raw: fenceLines.join("\n"),
      closed: false,
    });
  } else {
    flushText();
  }

  return segments;
}
