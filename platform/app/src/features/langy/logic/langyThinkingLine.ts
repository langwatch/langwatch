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
 *   1. A tool is running    → say what it is. We know: it is on the tool stream.
 *   2. Tokens are arriving  → say NOTHING. The streaming answer is on screen
 *                              and speaks for itself; a line under it reads
 *                              as still waiting for the visible reply.
 *   3. Reasoning is arriving → "Thinking…". The model IS working — live
 *                              reasoning deltas are on the wire — so it must
 *                              never read as a startup wait.
 *   4. None of those        → we are waiting for a worker that has not started.
 *                              Say so, plainly, and let it ESCALATE with time. A
 *                              turn that is stuck must eventually look stuck.
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

/**
 * The minimal structural shape of a chat message the wire-truth helpers below
 * read. Shared with `langyWaveMotion` — the fold derives its motion from the
 * SAME provable signals this line derives its words from.
 */
export interface ThinkingMessage {
  role: string;
  parts?: (ToolPart & { type?: string; text?: string })[];
}

/**
 * How long we wait before admitting nothing is happening.
 *
 * A cold spawn legitimately takes a few seconds (fork the worker, lay out the
 * home, install skills, wait for readiness), so silence is normal at first. The
 * first two steps name the startup's real phases — the control plane prepares
 * the worker's workspace, then the agent starts — so the wait reads as
 * progress, not one frozen line. It stops being normal quickly, and by 75s a
 * spawn that has produced NOTHING has almost certainly failed — the manager's
 * own readiness budget is long gone.
 */
export const THINKING_STARTING_LANGY_MS = 6_000;
export const THINKING_STILL_STARTING_MS = 12_000;
export const THINKING_SLOW_MS = 35_000;
export const THINKING_STUCK_MS = 75_000;

/**
 * The assistant message of the CURRENT turn: the one after the last user
 * message, or nothing while the reply has not started arriving. The wire-truth
 * checks below must read THIS message, never the last assistant overall — on a
 * follow-up send the last assistant overall is the PREVIOUS completed reply,
 * whose settled text would read as this turn already generating when it has
 * produced nothing.
 */
export function currentTurnAssistant(
  messages: ThinkingMessage[],
): ThinkingMessage | undefined {
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  return messages.slice(lastUserIndex + 1).find((m) => m.role === "assistant");
}

/** Has any earlier turn of this conversation already been answered? */
export function hasPriorReply(messages: ThinkingMessage[]): boolean {
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  return messages
    .slice(0, Math.max(lastUserIndex, 0))
    .some((m) => m.role === "assistant");
}

/** The last tool call that has NOT settled — the one actually running now. */
export function runningTool(message: ThinkingMessage | undefined): ToolPart | null {
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

/** Has any tool call on this turn already finished, well or badly? */
export function settledTool(message: ThinkingMessage | undefined): boolean {
  return !!message?.parts?.some(
    (part) =>
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      (part.state === "output-available" || part.state === "output-error"),
  );
}

/** Has the model actually produced any prose yet? */
export function hasTokens(message: ThinkingMessage | undefined): boolean {
  return !!message?.parts?.some((part) => part.type === "text" && !!part.text?.trim());
}

/**
 * The escalation the two waiting paths share: silence is normal for a moment,
 * then it is not, then it is a fault. Only the wording of the final admission
 * differs between a cold start and a follow-up, so one ladder serves both.
 * Returns nothing while the silence is still young enough to say something more
 * specific than "this is slow".
 */
function silenceEscalation({
  elapsedMs,
  stuckText,
}: {
  elapsedMs: number;
  stuckText: string;
}): LangyThinkingLine | undefined {
  if (elapsedMs >= THINKING_STUCK_MS) {
    return { text: stuckText, tone: "stuck", allowWhimsy: false };
  }
  if (elapsedMs >= THINKING_SLOW_MS) {
    return {
      text: "This is taking longer than usual…",
      tone: "waiting",
      allowWhimsy: false,
    };
  }
  return undefined;
}

/**
 * Nothing is on the wire yet. What that MEANS depends on whether this
 * conversation has answered before: a follow-up is waiting on a worker that is
 * (almost always) alive, so the model is working; a first turn is waiting on a
 * worker that does not exist yet, so the startup phases are the true account.
 */
function waitingLine({
  messages,
  elapsedMs,
  workerReady,
}: {
  messages: ThinkingMessage[];
  elapsedMs: number;
  workerReady: boolean;
}): LangyThinkingLine {
  // A FOLLOW-UP IS WAITING — or a first message whose worker a panel-open warm
  // already PROVED alive (`workerReady`). Either way the model is working, not
  // booting; the manager's own "Thinking…" status lands moments later and
  // takes over. The startup ladder here would claim a boot that is not
  // happening, and a connection-flavoured line read as a lost connection. Long
  // silence still escalates, because a live worker can wedge too.
  if (hasPriorReply(messages) || workerReady) {
    return (
      silenceEscalation({
        elapsedMs,
        stuckText: "Langy still hasn't answered — it may be stuck.",
      }) ?? { text: "Thinking…", tone: "waiting", allowWhimsy: false }
    );
  }

  // NOTHING HAS HAPPENED. No tool, no token, no reasoning. We are waiting on a
  // worker that has not started, and we must not pretend otherwise.
  const escalated = silenceEscalation({
    elapsedMs,
    stuckText: "Langy still hasn't started — it may be stuck.",
  });
  if (escalated) return escalated;

  if (elapsedMs >= THINKING_STILL_STARTING_MS) {
    return { text: "Still starting up…", tone: "waiting", allowWhimsy: false };
  }
  if (elapsedMs >= THINKING_STARTING_LANGY_MS) {
    return { text: "Starting Langy…", tone: "waiting", allowWhimsy: false };
  }
  // The first phase of a cold turn: the control plane resolves credentials and
  // lays out the worker's home before the agent process exists. The manager's
  // own "Starting Langy…" status replaces this line the moment the worker is
  // up (langyChatTransport), so on a warm turn this shows only for a blink.
  return {
    text: "Preparing Langy's workspace…",
    tone: "waiting",
    allowWhimsy: false,
  };
}

/**
 * The line for the current state of a turn, or null when no line should
 * render at all (the streaming answer is on screen and speaks for itself).
 *
 * Pure: the caller measures `elapsedMs` (time since the turn was sent) and owns
 * the clock. Everything here is derived from what is provably on the wire.
 */
export function langyThinkingLine({
  messages,
  elapsedMs,
  hasLiveReasoning = false,
  workerReady = false,
}: {
  messages: ThinkingMessage[];
  /** Time since the turn was sent. */
  elapsedMs: number;
  /**
   * The model's ephemeral reasoning is streaming right now. Reasoning deltas
   * never become message parts (they are live-edge only), so without this
   * signal a reasoning-but-no-prose turn read as a startup wait — a false
   * claim: the model is provably working.
   */
  hasLiveReasoning?: boolean;
  /**
   * A panel-open warm proved this conversation's worker alive before the send
   * (`warmed: true` from `langy.warmWorker`). A first message then skips the
   * startup ladder — the workspace it would claim to be preparing already
   * exists — and reads "Thinking…" like a follow-up. If the proof went stale
   * (the worker was reaped since), the manager's readiness status corrects
   * the line moments later, the same recovery a follow-up relies on.
   */
  workerReady?: boolean;
}): LangyThinkingLine | null {
  const last = currentTurnAssistant(messages);

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

  // 2. TOKENS ARE ARRIVING. The streaming prose is on screen right above this
  //    line, so the answer itself is the status — a second line under it
  //    ("Writing…", or any status orb) reads as the panel still waiting for
  //    the reply that is visibly arriving. Render nothing.
  if (hasTokens(last)) {
    return null;
  }

  // 3. REASONING IS ARRIVING. No prose yet, but the model is provably working —
  //    its thinking is on the wire (rendered live above this line). Say
  //    "Thinking…" plainly; the reasoning stream itself is the show, so no
  //    whimsy cycling on top of it.
  if (hasLiveReasoning) {
    return { text: "Thinking…", tone: "working", allowWhimsy: false };
  }

  // 4. THE TURN IS BETWEEN STEPS. Nothing is running right now, but tool calls
  //    have already SETTLED on this turn — so the worker demonstrably started,
  //    and the startup ladder below would be a plain lie (a startup line under
  //    four completed actions). The model is choosing its next move, which is
  //    the same state as case 3 and reads the same way.
  if (settledTool(last)) {
    return { text: "Thinking…", tone: "working", allowWhimsy: true };
  }

  // 5. NOTHING IS ON THE WIRE. What the silence means, and how it escalates,
  //    depends on whether this conversation has answered before — or already
  //    holds a warm-proven worker.
  return waitingLine({ messages, elapsedMs, workerReady });
}
