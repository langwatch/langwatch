/**
 * One assistant turn, split into the runs it is read in.
 */
import { LANGY_CARD_FAILED_PART_TYPE, LANGY_CARD_PART_TYPE } from "@langwatch/langy-contract";

import { isQuestionToolPart } from "./langy-question-tool.ts";
import { isSayToolPart } from "./langy-say-tool.ts";

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
 * `reasoning` folds into the process record, and `step-start` is the AI SDK's own
 * boundary marker.
 */
const INERT_PART_TYPES = new Set<string>(["reasoning", "step-start"]);

function partType(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined;
  const type = (part as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

/** Does this part render nowhere in the transcript, so it splits no run? */
function isInertPart(part: unknown): boolean {
  const type = partType(part);
  return type !== undefined && INERT_PART_TYPES.has(type);
}

/** Which run a part belongs to: a said line, the reply, or the work behind it. */
function runKindOf(part: unknown): LangyTranscriptRun["kind"] {
  if (isSayToolPart(part)) return "say";
  const type = partType(part);
  return type !== undefined && ANSWER_PART_TYPES.has(type) ? "answer" : "activity";
}

/** The turn's parts, grouped into the runs they are read in. */
export function langyTranscriptRuns(parts: readonly unknown[]): LangyTranscriptRun[] {
  const runs: LangyTranscriptRun[] = [];
  // A question's card is drawn after the run that holds the call, so the run
  // ends on the question: the calls that follow the answer start a new run and
  // their rows sit under the card, not between the question and it.
  let closed = false;

  for (const part of parts) {
    if (isInertPart(part)) continue;
    const kind = runKindOf(part);
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
 * Does the panel draw this message? `user`/`assistant` are the conversation; `system` is a
 * durable platform notice, drawn but neither question nor answer. A `tool` result belongs to
 * the activity cards instead. Shared by the engine's hydration and the panel's message count.
 */
export function isLangyTranscriptMessage(message: { role: string }): boolean {
  return TRANSCRIPT_ROLES.has(message.role);
}

/** The prose of an answer run: its text parts, one paragraph break apart. */
export function langyRunText(parts: readonly unknown[]): string {
  return parts
    .filter((part) => partType(part) === "text")
    .map((part) => (part as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("\n\n");
}
