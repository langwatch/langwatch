/**
 * TIME TRAVEL for the chat panel itself (developer mode).
 */
import { LANGY_CONVERSATION_EVENT_TYPES, type LangyEventCursor } from "@langwatch/langy-contract";

import type { LangyMessageDto } from "@langwatch/langy-contract";
import {
  type LangyDevLogRecord,
  replayTurnProjection,
  streamRecords,
  tapeUpTo,
} from "../stores/langy-dev-log";

/** The minimal structural message the panel's renderer needs. */
export interface TimeTravelMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
}

export interface LangyTimeTravelView {
  /** The wall-clock moment being viewed (the last visible record's time). */
  atMs: number;
  messages: TimeTravelMessage[];
  isTurnInFlight: boolean;
  signals: {
    status: string | null;
    progress: number | null;
    reasoning: string | null;
  };
  /** The replayed fold's cursor at the moment — the readout's anchor. */
  cursor: LangyEventCursor | null;
}

export function buildTimeTravelView({
  records,
  scrubSeq,
  historyMessages,
}: {
  records: LangyDevLogRecord[];
  scrubSeq: number | null;
  historyMessages: LangyMessageDto[];
}): LangyTimeTravelView | null {
  if (scrubSeq === null) return null;
  const visible = tapeUpTo(records, scrubSeq);
  const atMs = visible.at(-1)?.atMs ?? 0;
  const fold = replayTurnProjection(visible);

  // Settled messages carry a SERVER-TIME sort key, and the two sources share one clock
  // by construction: a history row's createdAtMs IS the event's occurredAt (the message
  // map stamps CreatedAt from it).
  const settled: { key: number; message: TimeTravelMessage }[] = [];

  // History rows the durable projection had by the moment. Rows with no
  // timestamp (older builds default 0) are always in.
  const seenIds = new Set<string>();
  for (const message of historyMessages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if ((message.createdAtMs ?? 0) > atMs) continue;
    seenIds.add(message.id);
    settled.push({
      key: message.createdAtMs ?? 0,
      message: { id: message.id, role: message.role, parts: message.parts },
    });
  }

  // Settled answers from the recorded EVENT LOG itself — parts exactly as the
  // terminal event carried them, deduplicated against history by messageId so
  // client/server clock skew can never double-render an answer.
  for (const record of visible) {
    if (record.lane !== "durable" || record.source !== "tail") continue;
    const event = record.event;
    if (event.type !== LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED) continue;
    if (seenIds.has(event.data.messageId)) continue;
    seenIds.add(event.data.messageId);
    settled.push({
      key: event.occurredAt,
      message: {
        id: event.data.messageId,
        role: "assistant",
        parts: event.data.parts,
      },
    });
  }

  // Stable sort on the shared server clock; legacy zero-keyed rows keep their
  // arrival order at the front.
  settled.sort((a, b) => a.key - b.key);
  const messages = settled.map((entry) => entry.message);

  const terminal =
    fold.turn?.Status === "completed" ||
    fold.turn?.Status === "failed" ||
    fold.turn?.Status === "stopped";

  // The moment's live edge: a send whose message_recorded had not landed in
  // the history rows yet — show the user's text from the outbound lane.
  const lastSend = [...visible]
    .reverse()
    .find(
      (record): record is Extract<LangyDevLogRecord, { lane: "outbound" }> =>
        record.lane === "outbound" && record.kind === "send",
    );
  const running = fold.turn?.Status === "running";
  const newestBaselineUserAt = Math.max(
    0,
    ...historyMessages
      .filter((message) => message.role === "user" && (message.createdAtMs ?? 0) <= atMs)
      .map((message) => message.createdAtMs ?? 0),
  );
  const sendText = lastSend
    ? ((lastSend.detail as { text?: string } | null)?.text ?? lastSend.label)
    : null;
  // Skew guard alongside the timestamp check: if a history row already shows
  // this exact text as the newest user message, the send has landed — a
  // synthetic copy would render the question twice.
  const lastSettledUser = [...messages].reverse().find((message) => message.role === "user");
  const sendAlreadySettled =
    !!sendText &&
    !!lastSettledUser &&
    JSON.stringify(lastSettledUser.parts).includes(JSON.stringify(sendText));
  const pendingSend =
    !!lastSend && !terminal && !sendAlreadySettled && lastSend.atMs > newestBaselineUserAt;

  if (pendingSend && lastSend) {
    messages.push({
      id: `tt-send-${lastSend.seq}`,
      role: "user",
      parts: [{ type: "text", text: sendText ?? lastSend.label }],
    });
  }

  // Mid-turn: the partial answer, exactly as far as it had streamed.
  let streamedText = "";
  let reasoning = "";
  let status: string | null = null;
  let progress: number | null = null;
  if (!terminal) {
    for (const record of streamRecords(visible)) {
      // Deltas for the CURRENT turn only — a scrub position inside an earlier
      // turn folds that turn instead, and its deltas match by turnId too.
      if (fold.turnId !== null && record.turnId !== fold.turnId) continue;
      const entry = record.entry;
      if (entry.type === "delta") streamedText += entry.text;
      else if (entry.type === "reasoning") reasoning += entry.text;
      else if (entry.type === "status") status = entry.status || null;
      else if (entry.type === "progress") {
        progress = entry.progress ?? progress;
        if (entry.message) status = entry.message;
      }
    }
  }

  // THE SETTLE GAP. The answer's history row lands on the SERVER clock, but the fold
  // only turns terminal once the closing event reaches the tape — a catch-up round-trip
  // later.
  const lastSettledAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const answerLanded =
    !!streamedText &&
    !!lastSettledAssistant &&
    settledPartsText(lastSettledAssistant.parts).startsWith(streamedText.trimEnd());

  if (streamedText && !answerLanded) {
    messages.push({
      id: `tt-partial-${fold.turnId ?? "pending"}`,
      role: "assistant",
      parts: [{ type: "text", text: streamedText }],
    });
  }

  // A pending send is the NEXT turn knocking — it stays in flight even when
  // the previous answer has landed.
  const isTurnInFlight =
    pendingSend || ((running || (!terminal && !!streamedText)) && !answerLanded);

  return {
    atMs,
    messages,
    isTurnInFlight,
    signals: {
      status: isTurnInFlight ? status : null,
      progress: isTurnInFlight ? progress : null,
      reasoning: isTurnInFlight && reasoning ? reasoning : null,
    },
    cursor: fold.cursor,
  };
}

/** The message's prose — its text parts, concatenated in order. */
function settledPartsText(parts: unknown[]): string {
  let text = "";
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type !== "text") continue;
    if (typeof candidate.text !== "string") continue;
    text += candidate.text;
  }
  return text;
}
