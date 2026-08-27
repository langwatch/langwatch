import {
  extractLangyTextFromParts,
  LANGY_CONVERSATION_EVENT_TYPES,
  LangyConversationNotFoundError,
  type LangyConversationTurnWireEvent,
  type LangyEventCursor,
} from "@langwatch/langy-contract";
import { LangyTokenBuffer } from "./langy-token-buffer";

export type TurnSettlement =
  | {
      succeeded: true;
      outcome: "completed" | "stopped";
      text: string;
      error: null;
    }
  | { succeeded: false; outcome: "failed"; text: null; error: string };

export type LangyTurnSettlementReader = {
  getEventsAfter(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    after: LangyEventCursor;
  }): Promise<{
    events: LangyConversationTurnWireEvent[];
    cursor: LangyEventCursor;
    truncated: boolean;
  }>;
};

export type LangyTurnSettlementRedis = {
  duplicate(): { disconnect(): void };
};

const bufferedPollMs = 5_000;
const fallbackPollMs = 750;
const confirmPollMs = 250;

export function abortableDelay(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function settlementFromEvents(
  events: LangyConversationTurnWireEvent[],
  turnId: string,
): TurnSettlement | null {
  for (const event of events) {
    const settlement = settlementFromEvent(event, turnId);
    if (settlement) return settlement;
  }

  return null;
}

function settlementFromEvent(
  event: LangyConversationTurnWireEvent,
  turnId: string,
): TurnSettlement | null {
  if (
    event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED &&
    event.data.turnId === turnId
  ) {
    if (event.data.outcome === "failed") {
      return {
        succeeded: false,
        outcome: "failed",
        text: null,
        error: event.data.error ?? "Turn failed",
      };
    }

    return {
      succeeded: true,
      outcome: event.data.outcome,
      text: extractLangyTextFromParts(event.data.parts),
      error: null,
    };
  }

  if (
    event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED &&
    event.data.turnId === turnId
  ) {
    return {
      succeeded: false,
      outcome: "failed",
      text: null,
      error: event.data.error,
    };
  }

  return null;
}

async function readSettlementFromFold(input: {
  langy: LangyTurnSettlementReader;
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  signal: AbortSignal;
}): Promise<TurnSettlement | null> {
  let cursor: LangyEventCursor = { acceptedAt: 0, eventId: "" };

  while (!input.signal.aborted) {
    const page = await input.langy
      .getEventsAfter({
        projectId: input.projectId,
        conversationId: input.conversationId,
        userId: input.userId,
        after: cursor,
      })
      .catch((error: unknown) => {
        if (error instanceof LangyConversationNotFoundError) return null;
        throw error;
      });
    if (!page) return null;

    const settlement = settlementFromEvents(page.events, input.turnId);
    if (settlement) return settlement;
    if (!page.truncated) return null;

    cursor = page.cursor;
  }

  return null;
}

function neverSettles(): Promise<never> {
  return new Promise<never>(() => {});
}

function isTerminalFrame(entry: { type: string }): boolean {
  return entry.type === "end" || entry.type === "error";
}

async function watchBufferForTerminal(
  buffer: LangyTokenBuffer,
  input: { conversationId: string; turnId: string; signal: AbortSignal },
): Promise<void> {
  const { reads, lastId } = await buffer.readTail({
    conversationId: input.conversationId,
    turnId: input.turnId,
  });
  if (reads.some(({ entry }) => isTerminalFrame(entry))) return;

  for await (const { entry } of buffer.follow({
    conversationId: input.conversationId,
    turnId: input.turnId,
    fromId: lastId,
    signal: input.signal,
  })) {
    if (isTerminalFrame(entry)) return;
  }

  await neverSettles();
}

function armBufferWatch(input: {
  redis: LangyTurnSettlementRedis | null;
  conversationId: string;
  turnId: string;
  signal: AbortSignal;
}): { terminalSeen: Promise<void> | null; release: () => void } {
  if (!input.redis) {
    return { terminalSeen: null, release: () => {} };
  }

  const blockingRedis = input.redis.duplicate();
  const buffer = LangyTokenBuffer.create({
    redis: input.redis,
    blockingRedis,
  });

  return {
    terminalSeen: watchBufferForTerminal(buffer, input).catch(() => neverSettles()),
    release: () => blockingRedis.disconnect(),
  };
}

async function waitForNextPoll(
  terminalSeen: Promise<void> | null,
  pollMs: number,
  signal: AbortSignal,
): Promise<"tick" | "terminal" | "abort"> {
  const delay: Promise<"tick" | "abort"> = abortableDelay(pollMs, signal).then(
    (completed): "tick" | "abort" => (completed ? "tick" : "abort"),
  );
  if (!terminalSeen) return delay;

  const terminal: Promise<"terminal"> = terminalSeen.then((): "terminal" => "terminal");
  return Promise.race([terminal, delay]);
}

export async function awaitTurnSettlement(input: {
  langy: LangyTurnSettlementReader;
  redis: LangyTurnSettlementRedis | null;
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  signal: AbortSignal;
  pollIntervalMs?: number;
}): Promise<TurnSettlement | null> {
  const armed = armBufferWatch(input);
  let terminalSeen = armed.terminalSeen;
  let pollMs = terminalSeen ? bufferedPollMs : (input.pollIntervalMs ?? fallbackPollMs);

  try {
    while (!input.signal.aborted) {
      const settlement = await readSettlementFromFold(input);
      if (settlement) return settlement;

      const outcome = await waitForNextPoll(terminalSeen, pollMs, input.signal);
      if (outcome === "abort") return null;
      if (outcome === "terminal") {
        terminalSeen = null;
        pollMs = confirmPollMs;
      }
    }

    return null;
  } finally {
    armed.release();
  }
}
