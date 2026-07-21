/**
 * TIME TRAVEL for the chat panel itself (developer mode).
 *
 * When the inspector's scrubber leaves LIVE, the panel stops rendering the
 * engine's present and renders THIS view instead: the conversation as it stood
 * at one moment of the recorded tape. It is a pure function of (tape prefix,
 * durable history) — no store is mutated, no engine state is touched, and
 * snapping back to LIVE simply stops substituting. Rendering the past must
 * never be able to corrupt the present.
 *
 * How the moment is reconstructed, per source of truth:
 *
 *   settled turns   from the DURABLE lane: every `agent_responded` at or
 *                   before the moment contributes its recorded AnswerParts,
 *                   deduplicated against the history rows by messageId (the
 *                   event and the projection row share the id by design).
 *   history rows    `langy.messages` rows whose createdAtMs is at or before
 *                   the moment — the conversation as the durable projections
 *                   had it. Rows carry server clocks and the tape carries this
 *                   client's, so the durable-event dedup above is what keeps
 *                   skew from double-rendering an answer.
 *   the live turn   when the replayed fold is mid-turn at the moment: the
 *                   user's just-sent text from the OUTBOUND lane, and the
 *                   partial answer from the STREAM lane's deltas for that
 *                   turn — the prose exactly as far as it had streamed.
 *   the signals     the last status/progress at or before the moment, and the
 *                   turn's accumulated reasoning — what the thinking line and
 *                   status row were showing right then.
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  type LangyEventCursor,
} from "@langwatch/langy";

import type { LangyMessageDto } from "../data/langy.dtos";
import {
  replayTurnProjection,
  streamRecords,
  tapeUpTo,
  type LangyDevLogRecord,
} from "../stores/langyDevLog";

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

  // Settled messages carry a SERVER-TIME sort key, and the two sources share
  // one clock by construction: a history row's createdAtMs IS the event's
  // occurredAt (the message map stamps CreatedAt from it). Merging on that key
  // is what keeps order right — an answer recorded on the tape but not yet in
  // the history rows must still sort BETWEEN its question and the next one,
  // never appended at the end of the whole baseline.
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
      .filter(
        (message) =>
          message.role === "user" && (message.createdAtMs ?? 0) <= atMs,
      )
      .map((message) => message.createdAtMs ?? 0),
  );
  const sendText = lastSend
    ? ((lastSend.detail as { text?: string } | null)?.text ?? lastSend.label)
    : null;
  // Skew guard alongside the timestamp check: if a history row already shows
  // this exact text as the newest user message, the send has landed — a
  // synthetic copy would render the question twice.
  const lastSettledUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const sendAlreadySettled =
    !!sendText &&
    !!lastSettledUser &&
    JSON.stringify(lastSettledUser.parts).includes(JSON.stringify(sendText));
  const pendingSend =
    !!lastSend &&
    !terminal &&
    !sendAlreadySettled &&
    lastSend.atMs > newestBaselineUserAt;

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
    if (streamedText) {
      messages.push({
        id: `tt-partial-${fold.turnId ?? "pending"}`,
        role: "assistant",
        parts: [{ type: "text", text: streamedText }],
      });
    }
  }

  const isTurnInFlight = running || pendingSend || (!terminal && !!streamedText);

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
