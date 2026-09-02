/**
 * One assistant turn, split into the runs it is read in.
 *
 * A turn is a sequence of events: a paragraph, a call, another paragraph,
 * another call. The panel used to render it as two piles keyed by kind — every
 * tool card, then the whole reply joined into one body underneath — so a reader
 * watching a live turn saw cards change at the top while text grew at the
 * bottom, with nothing on screen saying which paragraph followed which call.
 *
 * This is the pure split that fixes it: consecutive answer parts (prose and the
 * stamped card blocks that belong to the reply) form an ANSWER run, consecutive
 * tool parts form an ACTIVITY run, and the runs come back in the order the
 * parts carry. Each run is then handed to the renderer that already owns it —
 * `langyAnswerSegments` for the answer, `LangyActivityParts` for the activity —
 * so this module decides ordering and nothing else.
 *
 * Reasoning parts belong to neither: the model's thinking is not the answer,
 * and it is folded into the turn's process record elsewhere
 * (logic/langyReasoningTitles).
 */
import {
  LANGY_CARD_FAILED_PART_TYPE,
  LANGY_CARD_PART_TYPE,
} from "@langwatch/langy-contract";

export type LangyTranscriptRun =
  /** Prose, and the card blocks stamped into the reply's own flow. */
  | { kind: "answer"; parts: readonly unknown[] }
  /** Tool calls, rendered as the activity cards for the work they did. */
  | { kind: "activity"; parts: readonly unknown[] };

/** Parts that are the reply itself rather than the work behind it. */
const ANSWER_PART_TYPES = new Set<string>([
  "text",
  LANGY_CARD_PART_TYPE,
  LANGY_CARD_FAILED_PART_TYPE,
]);

/**
 * Parts that render nowhere in the transcript, so they must not split a run:
 * `reasoning` folds into the process record, and `step-start` is the AI SDK's
 * own boundary marker. Left in, either would cut a paragraph in half and put a
 * seam in the middle of the reply.
 */
const INERT_PART_TYPES = new Set<string>(["reasoning", "step-start"]);

function partType(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined;
  const type = (part as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

/** The turn's parts, grouped into the runs they are read in. */
export function langyTranscriptRuns(
  parts: readonly unknown[],
): LangyTranscriptRun[] {
  const runs: LangyTranscriptRun[] = [];

  for (const part of parts) {
    const type = partType(part);
    if (type !== undefined && INERT_PART_TYPES.has(type)) continue;
    const kind =
      type !== undefined && ANSWER_PART_TYPES.has(type) ? "answer" : "activity";
    const open = runs.at(-1);
    if (open?.kind === kind) {
      open.parts = [...open.parts, part];
      continue;
    }
    runs.push({ kind, parts: [part] });
  }

  return runs;
}

/** The prose of an answer run: its text parts, one paragraph break apart. */
export function langyRunText(parts: readonly unknown[]): string {
  return parts
    .filter((part) => partType(part) === "text")
    .map((part) => (part as { text?: unknown }).text)
    .filter(
      (text): text is string => typeof text === "string" && text.length > 0,
    )
    .join("\n\n");
}
