import { parseLangwatchCommand } from "@langwatch/langy-contract";

/**
 * Derives an honest status from observable turn signals. A running tool is named,
 * visible tokens need no extra line, live reasoning says “Thinking…”, and silence
 * escalates from waiting to stuck.
 */

/** What the line is describing, so the caller can pick its treatment. */
export type LangyThinkingTone =
  /** A tool is running, or tokens are arriving. Real work; whimsy allowed. */
  | "working"
  /** Nothing has happened yet. We are waiting on the worker. */
  | "waiting"
  /** Long enough with nothing that the honest word is "stuck". */
  | "stuck";

export interface LangyThinkingLineState {
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

export interface LangyToolNarrator {
  describe(input: { name: string; toolInput: unknown }): {
    title: string;
    detail?: string;
  };
}

function defaultToolNarrator({ name, toolInput }: { name: string; toolInput: unknown }): {
  title: string;
  detail?: string;
} {
  const input = toolInput && typeof toolInput === "object" ? toolInput : undefined;
  const command = input && "command" in input ? input.command : undefined;

  if (typeof command === "string") {
    const parsed = parseLangwatchCommand(command);
    if (parsed) {
      return {
        title: `${parsed.verb[0]?.toUpperCase() ?? ""}${parsed.verb.slice(1)}ing ${parsed.resource}`,
        detail: command,
      };
    }
  }

  return { title: name.replace(/[_.-]+/g, " ") };
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
 */
export const THINKING_STARTING_LANGY_MS = 6_000;
export const THINKING_STILL_STARTING_MS = 12_000;
export const THINKING_SLOW_MS = 35_000;
export const THINKING_STUCK_MS = 75_000;

/**
 * The assistant message of the CURRENT turn: the one after the last user message, or
 * nothing while the reply has not started arriving.
 */
export function currentTurnAssistant(messages: ThinkingMessage[]): ThinkingMessage | undefined {
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  return messages.slice(lastUserIndex + 1).find((m) => m.role === "assistant");
}

/** Has any earlier turn of this conversation already been answered? */
export function hasPriorReply(messages: ThinkingMessage[]): boolean {
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  return messages.slice(0, Math.max(lastUserIndex, 0)).some((m) => m.role === "assistant");
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
 * The escalation the two waiting paths share: silence is normal for a moment, then it
 * is not, then it is a fault. Only the wording of the final admission differs between a
 * cold start and a follow-up, so one ladder serves both.
 */
function silenceEscalation({
  elapsedMs,
  stuckText,
}: {
  elapsedMs: number;
  stuckText: string;
}): LangyThinkingLineState | undefined {
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
 * Nothing is on the wire yet.
 */
function waitingLine({
  messages,
  elapsedMs,
  workerReady,
}: {
  messages: ThinkingMessage[];
  elapsedMs: number;
  workerReady: boolean;
}): LangyThinkingLineState {
  // A FOLLOW-UP IS WAITING — or a first message whose worker a panel-open warm already
  // PROVED alive (`workerReady`). Either way the model is working, not booting; the
  // manager's own "Thinking…" status lands moments later and takes over.
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
 * The line for the current state of a turn, or null when no line should render at all
 * (the streaming answer is on screen and speaks for itself).
 */
export function langyThinkingLine({
  messages,
  elapsedMs,
  hasLiveReasoning = false,
  workerReady = false,
  toolNarrator,
  pageActivity = null,
}: {
  messages: ThinkingMessage[];
  /** Time since the turn was sent. */
  elapsedMs: number;
  /**
   * What the page Langy is driving is doing right now, in the page's own words, or null
   * when it is doing nothing.
   */
  pageActivity?: string | null;
  /**
   * The model's ephemeral reasoning is streaming right now.
   */
  hasLiveReasoning?: boolean;
  /**
   * A panel-open warm proved this conversation's worker alive before the send (`warmed:
   * true` from `langy.warmWorker`).
   */
  workerReady?: boolean;
  toolNarrator?: LangyToolNarrator;
}): LangyThinkingLineState | null {
  const last = currentTurnAssistant(messages);

  // 0. THE PAGE IS DOING SOMETHING. It reports its own work, so this is both
  //    true and more specific than anything below: the column being run and
  //    the rows already back, rather than the poll the agent is blocked on.
  const reported = pageActivity?.trim();
  if (reported) {
    return { text: reported, tone: "working", allowWhimsy: false };
  }

  // 1. A TOOL IS RUNNING. We know exactly what it is — it is on the tool stream,
  //    with its command in the input. Say the true thing.
  const tool = runningTool(last);
  if (tool?.type) {
    const name = tool.type.slice("tool-".length);
    const narrator = toolNarrator?.describe ?? defaultToolNarrator;
    const { title, detail } = narrator({ name, toolInput: tool.input });
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
