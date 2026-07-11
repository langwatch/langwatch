import { describeToolCall, effectiveToolName } from "./langyToolLabel";

/**
 * What the thinking line is allowed to SAY.
 *
 * ── THE BUG THIS EXISTS TO KILL ────────────────────────────────────────────
 *
 * The line used to cycle `LANGY_THINKING_VERBS` on a 3.6s timer whenever a turn
 * was in flight, regardless of whether anything was happening. So a turn whose
 * worker never spawned — nothing running, not one token — spent ninety-seven
 * seconds announcing "Writing a TODO list…", "Calling one more tool…", "Reading
 * the whole file…" before dying.
 *
 * Every one of those is a CLAIM ABOUT WORK, and every one of them was false. It
 * is not a cosmetic problem: it made a dead turn read as a healthy one, to the
 * point that a stuck spawn was diagnosed as "Langy is slow" for a whole session.
 * The product was PERFORMING progress it was not making.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * The line may only say things that are TRUE at the moment it says them.
 *
 *   1. A tool is running   → say what it is. We know: it is on the tool stream.
 *   2. Tokens are arriving → "Writing…". The model really is generating.
 *   3. Neither             → we are waiting for a worker that has not started.
 *                            Say so, plainly, and let it ESCALATE with time. A
 *                            turn that is stuck must eventually look stuck.
 *
 * Whimsy survives, because whimsy was never the problem — a joke about the
 * model's character ("Bribing the GPUs", "Blaming the NS") claims nothing about
 * the work. It is allowed ONLY while the model is genuinely working, and only
 * from the non-claiming pool. Cycling itself implies progress, so it never runs
 * while we are waiting.
 */

/** What the line is describing, so the caller can pick its treatment. */
export type LangyThinkingTone =
  /** A tool is running, or tokens are arriving. Real work; whimsy allowed. */
  | "working"
  /** Nothing has happened yet. We are waiting on the worker. */
  | "waiting"
  /** Long enough with nothing that the honest word is "stuck". */
  | "stuck";

export interface LangyThinkingLine {
  /** The line to render. Always true at the moment it is produced. */
  text: string;
  tone: LangyThinkingTone;
  /**
   * May the caller cycle whimsical verbs instead of `text`? Only ever true when
   * the model is genuinely generating and we have nothing more specific to say —
   * never while waiting, because cycling reads as progress.
   */
  allowWhimsy: boolean;
}

/** A tool part on the in-flight assistant message. */
interface ToolPart {
  type?: string;
  state?: string;
  input?: unknown;
}

interface ThinkingMessage {
  role: string;
  parts?: (ToolPart & { type?: string; text?: string })[];
}

/**
 * How long we wait before admitting nothing is happening.
 *
 * A cold spawn legitimately takes a few seconds (fork opencode, lay out the
 * home, install skills, wait for readiness), so silence is normal at first. It
 * stops being normal quickly, and by 75s a spawn that has produced NOTHING has
 * almost certainly failed — the manager's own readiness budget is long gone.
 */
export const THINKING_STILL_STARTING_MS = 12_000;
export const THINKING_SLOW_MS = 35_000;
export const THINKING_STUCK_MS = 75_000;

/** The last tool call that has NOT settled — the one actually running now. */
function runningTool(message: ThinkingMessage | undefined): ToolPart | null {
  if (!message?.parts) return null;
  const running = message.parts.findLast(
    (part) =>
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      part.state !== "output-available" &&
      part.state !== "output-error",
  );
  return running ?? null;
}

/** Has the model actually produced any prose yet? */
function hasTokens(message: ThinkingMessage | undefined): boolean {
  return !!message?.parts?.some(
    (part) => part.type === "text" && !!part.text?.trim(),
  );
}

/**
 * The honest line for the current state of a turn.
 *
 * Pure: the caller measures `elapsedMs` (time since the turn was sent) and owns
 * the clock. Everything here is derived from what is provably on the wire.
 */
export function langyThinkingLine({
  messages,
  elapsedMs,
  optimisticText,
}: {
  messages: ThinkingMessage[];
  /** Time since the turn was sent. */
  elapsedMs: number;
  /** Stream B's raw tokens, which lead the durable text (ADR-048). */
  optimisticText?: string;
}): LangyThinkingLine {
  const last = [...messages].reverse().find((m) => m.role === "assistant");

  // 1. A TOOL IS RUNNING. We know exactly what it is — it is on the tool stream,
  //    with its command in the input. Say the true thing.
  const tool = runningTool(last);
  if (tool?.type) {
    const rawName = tool.type.slice("tool-".length);
    const { title, detail } = describeToolCall({
      name: effectiveToolName(rawName, tool.input),
      input: tool.input,
    });
    return {
      text: detail ? `${title} — ${detail}` : title,
      tone: "working",
      allowWhimsy: false,
    };
  }

  // 2. TOKENS ARE ARRIVING. The model really is generating, so a whimsical verb
  //    here claims nothing that isn't happening — it IS thinking.
  if (hasTokens(last) || !!optimisticText?.trim()) {
    return { text: "Writing…", tone: "working", allowWhimsy: true };
  }

  // 3. NOTHING HAS HAPPENED. No tool, no token. We are waiting on a worker that
  //    has not started, and we must not pretend otherwise. Escalate with time:
  //    silence is normal for a moment, then it isn't, then it's a fault.
  if (elapsedMs >= THINKING_STUCK_MS) {
    return {
      text: "Langy still hasn't started — it may be stuck.",
      tone: "stuck",
      allowWhimsy: false,
    };
  }
  if (elapsedMs >= THINKING_SLOW_MS) {
    return {
      text: "This is taking longer than usual…",
      tone: "waiting",
      allowWhimsy: false,
    };
  }
  if (elapsedMs >= THINKING_STILL_STARTING_MS) {
    return { text: "Still starting up…", tone: "waiting", allowWhimsy: false };
  }
  return { text: "Starting up…", tone: "waiting", allowWhimsy: false };
}
