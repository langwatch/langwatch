// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Bot Framework shapes a Copilot Studio transcript row arrives in, and the intermediate shapes
 * the mapping folds them into: conversations, turns and tool calls. Types and plain constants only,
 * so grouping, turn assembly and span building all name the same things.
 */

/** Bot Framework roles, as they appear in the stored activities. */
export const ROLE_AGENT = 0;
export const ROLE_USER = 1;

/**
 * Activity ids must be real GUIDs. The capture contains an activity whose id
 * is the string "0" and others with none at all, and both would seed a span
 * that either collides with a different turn or moves when the text changes.
 */
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActivityFrom {
  id?: string | null;
  role?: number | null;
  /** The only field naming a real directory account. Users only. */
  aadObjectId?: string | null;
  name?: string | null;
}

export interface ToolCallValue {
  toolCallId?: string | null;
  toolName?: string | null;
  toolDisplayName?: string | null;
  toolCallStatus?: string | null;
  status?: string | null;
  filledParameters?: Record<string, unknown> | null;
}

export interface Activity {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  valueType?: string | null;
  text?: string | null;
  timestamp?: number | string | null;
  timestampMs?: number | null;
  from?: ActivityFrom | null;
  value?: unknown;
}

/** The row fields this mapper reads. Everything else passes by. */
export interface TranscriptRow {
  /** Opaque grouping key. Never parsed — see `conversationKeyOf`. */
  name?: string | null;
  /**
   * Declared to record that the field exists and is deliberately unread. It
   * dates a session, not a conversation, so it is never an identity input —
   * two rows of one conversation carry different values here and must still
   * produce one trace. The puller reads it, as the event's timestamp.
   */
  conversationstarttime?: string | null;
  /**
   * Declared to record that the field exists and is deliberately unread. It
   * names a storage chunk, not a conversation, so it is never an identity
   * input — two rows of one conversation carry different values here and
   * must still produce one trace.
   */
  conversationtranscriptid?: string | null;
  metadata?: string | Record<string, unknown> | null;
  content?: string | { activities?: Activity[] | null } | null;
}

/**
 * What the adapter supplies about the agent, read from the joined bot row.
 *
 * There is no model here, and that is a finding rather than an omission. The
 * `bot` table carries `name`, `schemaname`, `language`, `authenticationmode`,
 * `statecode`, `publishedon` and `modifiedon` — and nothing naming a model.
 * An earlier draft emitted `copilot_studio.agent_model` from a field no query
 * could ever populate, which is worse than saying nothing: a reader would have
 * taken its absence as "not configured" rather than "not knowable from here".
 */
export interface BotFacts {
  botName?: string;
  /** When the agent was last changed. Later than the conversation = suspect. */
  modifiedOn?: string;
}

export const MS_THRESHOLD = 1_000_000_000_000;

export interface ConversationGroup {
  key: string;
  activities: Activity[];
  bot: BotFacts;
  /** Batch numbers seen, in the order applied. */
  batches: number[];
  /** True when the opening batch is absent, so the start is missing. */
  isIncomplete: boolean;
  /** True when the conversation happened while designing the agent. */
  isDesignMode: boolean;
}

/** One conversation's rows, with the agent facts seen alongside them. */
export interface ConversationBucket {
  rows: { batchId: number | null; row: TranscriptRow }[];
  bot: BotFacts;
}

/** A row together with the position it arrived in, which breaks sort ties. */
export interface IndexedRow {
  batchId: number | null;
  row: TranscriptRow;
  index: number;
}

/** A user question paired with the agent's reply, if it gave one. */
export interface Turn {
  /** The activity whose GUID seeds this turn's span. */
  seedActivityId: string;
  question: string | null;
  answer: string | null;
  /** Directory account of the person who asked; absent for agent-only turns. */
  authorAadObjectId: string | null;
  startMs: number;
  endMs: number;
}

/** A message activity that is identified, dated, and actually said something. */
export interface ReadableMessage {
  id: string;
  ms: number;
  text: string;
  role: number | null;
  /** Directory account of the speaker; only user messages carry one. */
  aadObjectId: string | null;
}

/** What pairing a conversation's messages into turns has built so far. */
export interface TurnAccumulator {
  turns: Turn[];
  open: Turn | null;
  skipped: number;
}

export interface ToolCall {
  seedActivityId: string;
  name: string;
  arguments: string | null;
  startMs: number;
  endMs: number;
  isFinished: boolean;
}

/**
 * Pair tool-call activities by their call id.
 *
 * Started and Completed are NOT one-to-one — the capture has two starts and
 * one completion, and the validation script that produced it states an
 * unpaired start is normal. A tool call that never reported finishing still
 * happened and still shows, marked unfinished. Waiting for a completion that
 * is not coming would hold the whole conversation back.
 */
/** One `ToolCallTrace:` activity, read into the fields the pairing needs. */
export interface ToolCallTrace {
  /** What pairs a start with its completion. */
  callId: string;
  seedActivityId: string;
  name: string;
  arguments: string | null;
  ms: number;
  isCompleted: boolean;
}
