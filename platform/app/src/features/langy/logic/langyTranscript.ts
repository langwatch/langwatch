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
 * A line said with the `say` tool is a third kind: a tool part by shape, but
 * Langy's own words by meaning, so it is drawn as prose where the call
 * happened and never joins an activity run (logic/langySayTool).
 *
 * Reasoning parts belong to none of them: the model's thinking is not the
 * answer, and it is folded into the turn's process record elsewhere
 * (logic/langyReasoningTitles).
 */
import {
  LANGY_CARD_FAILED_PART_TYPE,
  LANGY_CARD_PART_TYPE,
} from "@langwatch/langy";
import { isQuestionToolPart } from "./langyQuestionTool";
import { isSayToolPart } from "./langySayTool";

export type LangyTranscriptRun =
  /** Prose, and the card blocks stamped into the reply's own flow. */
  | { kind: "answer"; parts: readonly unknown[] }
  /** Tool calls, rendered as the activity cards for the work they did. */
  | { kind: "activity"; parts: readonly unknown[] }
  /** Lines said with the `say` tool, drawn as prose where they were said. */
  | { kind: "say"; parts: readonly unknown[] };

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
  // A question's card is drawn after the run that holds the call, so the run
  // ends on the question: the calls that follow the answer start a new run
  // and their rows sit under the card, not between the question and it.
  let closed = false;

  for (const part of parts) {
    const type = partType(part);
    if (type !== undefined && INERT_PART_TYPES.has(type)) continue;
    const kind: LangyTranscriptRun["kind"] = isSayToolPart(part)
      ? "say"
      : type !== undefined && ANSWER_PART_TYPES.has(type)
        ? "answer"
        : "activity";
    const open = runs.at(-1);
    if (open?.kind === kind && !closed) {
      open.parts = [...open.parts, part];
    } else {
      runs.push({ kind, parts: [part] });
    }
    closed = kind === "activity" && isQuestionToolPart(part);
  }

  return runs;
}

/** The roles the transcript draws. */
const TRANSCRIPT_ROLES = new Set<string>(["user", "assistant", "system"]);

/**
 * Does the panel draw this message?
 *
 * `user` and `assistant` are the conversation itself. `system` is a notice the
 * platform wrote into the transcript, such as the shared folder disconnecting:
 * the reader must see it, so it is durable and it is drawn, but it is neither a
 * question nor an answer. Every other role (a `tool` result) belongs to the
 * activity cards, which read the parts of the message they hang on.
 *
 * Both the engine's hydration and the panel's count of durable messages read
 * this, so the two can never fall out of step.
 */
export function isLangyTranscriptMessage(message: { role: string }): boolean {
  return TRANSCRIPT_ROLES.has(message.role);
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
