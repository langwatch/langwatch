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
function parseFenceLine(line: string): FenceLine {
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
  const scan: FenceScan = { segments: [], textLines: [], fenceLines: null, opaqueFenceTicks: null };
  for (const line of text.split("\n")) scanLine(scan, line);

  if (scan.fenceLines === null) flushText(scan);
  // Stream ended inside a langy-card fence: report it unclosed.
  else scan.segments.push({ type: "fence", raw: scan.fenceLines.join("\n"), closed: false });
  return scan.segments;
}

type FenceLine = { ticks: number; tag: string } | null;

type FenceScan = {
  segments: LangyCardFenceSegment[];
  textLines: string[];
  fenceLines: string[] | null;
  /** Inside a NON-langy-card fenced block: its content is opaque text. */
  opaqueFenceTicks: number | null;
};

function scanLine(scan: FenceScan, line: string): void {
  const fence = parseFenceLine(line);
  if (scan.fenceLines !== null) {
    scanCardLine({ scan, fenceLines: scan.fenceLines, line, fence });
    return;
  }
  if (scan.opaqueFenceTicks !== null) {
    // Inside some other code block: everything is literal text, and only
    // a closing fence with at least as many backticks ends it.
    scan.textLines.push(line);
    if (closesOpaqueFence(fence, scan.opaqueFenceTicks)) scan.opaqueFenceTicks = null;
    return;
  }
  if (fence?.tag === LANGY_CARD_FENCE_TAG) {
    flushText(scan);
    scan.fenceLines = [];
    return;
  }
  // An ordinary tagged code fence opens an opaque block; a bare ``` is literal text.
  if (fence && fence.tag !== "") scan.opaqueFenceTicks = fence.ticks;
  scan.textLines.push(line);
}

/** Inside a langy-card fence: only an untagged closing fence ends it. */
function scanCardLine({
  scan,
  fenceLines,
  line,
  fence,
}: {
  scan: FenceScan;
  fenceLines: string[];
  line: string;
  fence: FenceLine;
}): void {
  if (fence?.tag === "") {
    scan.segments.push({ type: "fence", raw: fenceLines.join("\n"), closed: true });
    scan.fenceLines = null;
    return;
  }
  fenceLines.push(line);
}

function closesOpaqueFence(fence: FenceLine, ticks: number): boolean {
  return fence !== null && fence.tag === "" && fence.ticks >= ticks;
}

function flushText(scan: FenceScan): void {
  if (scan.textLines.length === 0) return;
  const joined = scan.textLines.join("\n");
  scan.textLines = [];
  if (joined.length === 0) return;
  const previous = scan.segments[scan.segments.length - 1];
  if (previous?.type === "text") {
    scan.segments[scan.segments.length - 1] = { type: "text", text: `${previous.text}\n${joined}` };
    return;
  }
  scan.segments.push({ type: "text", text: joined });
}
