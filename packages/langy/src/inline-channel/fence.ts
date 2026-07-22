/**
 * The ```langy-card fence grammar (ADR-060 §1) — ONE scanner, shared by the
 * relay (which extracts fences from the settled assistant text to stamp
 * typed parts) and the client preview (which spots a forming fence in the
 * live token stream). Both sides split text through this module, so they
 * cannot disagree about where a card starts and ends.
 *
 * Grammar: a line that is only a code fence (three or more backticks) tagged
 * exactly `langy-card` opens a card; the next line that is only a closing
 * fence (three or more backticks, no tag) closes it. Scanning is
 * CommonMark-shaped about nesting: any OTHER fenced code block (```json,
 * ```markdown …) is opaque text, so a langy-card fence the model merely
 * quotes inside a code example never becomes a card. A fence still open at
 * the end of the text is reported unclosed — the preview treats that as a
 * forming card; the relay treats it as a truncated one and lets salvage
 * decide.
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

/** `["```", "langy-card"]` for a fence line, or null. */
function fenceLine(line: string): { ticks: number; tag: string } | null {
  const match = /^ {0,3}(`{3,})([^`]*)$/.exec(line);
  if (!match) return null;
  return { ticks: match[1]!.length, tag: match[2]!.trim() };
}

/**
 * Split text into prose and langy-card fences, in document order. Text
 * segments are verbatim (including any non-langy-card code fences); the
 * langy-card fence lines themselves are consumed. Adjacent text is merged,
 * and empty text segments are dropped.
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
    const fence = fenceLine(line);

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
