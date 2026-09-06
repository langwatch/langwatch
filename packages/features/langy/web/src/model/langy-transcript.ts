/**
 * One assistant turn, split into the runs it is read in.
 */
import { LANGY_CARD_FAILED_PART_TYPE, LANGY_CARD_PART_TYPE } from "@langwatch/langy-contract";

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
 * `reasoning` folds into the process record, and `step-start` is the AI SDK's own
 * boundary marker.
 */
const INERT_PART_TYPES = new Set<string>(["reasoning", "step-start"]);

function partType(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined;
  const type = (part as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

/** The turn's parts, grouped into the runs they are read in. */
export function langyTranscriptRuns(parts: readonly unknown[]): LangyTranscriptRun[] {
  const runs: LangyTranscriptRun[] = [];

  for (const part of parts) {
    const type = partType(part);
    if (type !== undefined && INERT_PART_TYPES.has(type)) continue;
    const kind = type !== undefined && ANSWER_PART_TYPES.has(type) ? "answer" : "activity";
    const open = runs.at(-1);
    if (open?.kind === kind) {
      open.parts = [...open.parts, part];
      continue;
    }
    runs.push({ kind, parts: [part] });
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
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("\n\n");
}
