// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Copilot Studio conversations, as stored in Dataverse, mapped to traces.
 *
 * A pulled event here is one row of the transcript table, and a row is not a
 * conversation. Dataverse caps a row at a megabyte, so a long conversation is
 * chopped into several rows that share a name and a start time and differ by
 * a batch number. Reassembling them is the first thing this does, and getting
 * it wrong splits one person's conversation into pieces that render as
 * separate chats.
 *
 * Inside a row, `content.activities` is a Bot Framework activity list where
 * most entries are bookkeeping. In the capture, 203 of 212 activities are
 * internal events and 7 carry something a person or the agent actually said.
 * Dropping 96% looks like a parsing failure and is not: an activity that says
 * nothing has nothing to render.
 *
 * Three traps that cost real debugging, kept close to the code that avoids
 * them:
 *
 *   - `from.id` is on every activity, is GUID-shaped, and is NOT a directory
 *     identifier. It is a per-conversation channel id that changes between
 *     conversations. Attributing a turn to it would invent a new "person" per
 *     conversation. The only identifier that names a real account is
 *     `from.aadObjectId`, which only user activities carry.
 *   - The row's own id names a storage chunk, not a conversation, so it is
 *     never an identity input. Two rows of one conversation have different
 *     row ids and must produce one trace.
 *   - An activity the mapper cannot date is dropped rather than stamped with
 *     the clock. Span storage breaks ties on start time, so a clock stamp
 *     beats the real record on the next pull and the wrong version wins
 *     permanently.
 */

import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import {
  assembleTraceRequest,
  type ConversationRoutingProfile,
  type ConversationSeeds,
  deriveConversationIdentity,
  hashId,
  intAttr,
  msToNano,
  type OtlpJsonAttr,
  type OtlpJsonSpan,
  originAttrs,
  type RoutingOrigin,
  stringAttr,
} from "./conversationTraceAssembly";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "./dataverseEnvironment";
import type { NormalizedPullEvent } from "./pullerAdapter";

/** The puller action that marks a pulled row as a conversation to route. */
export const COPILOT_CONVERSATION_ACTION = "copilot_conversation" as const;

/**
 * Agent identity on every turn. A product label, not a priced model: cost
 * enrichment runs on `llm` spans and must find no price row here. The model
 * the agent was actually running is recorded separately, as an attribute,
 * because it cannot be trusted enough to price anything.
 */
const COPILOT_AGENT_MODEL = "microsoft/copilot-studio" as const;

export const COPILOT_CONVERSATION_SPAN_NAME =
  "copilot_studio.conversation" as const;
export const COPILOT_TURN_SPAN_NAME = "copilot_studio.turn" as const;
export const COPILOT_TOOL_SPAN_NAME = "copilot_studio.tool_call" as const;

export const COPILOT_ROUTING_PROFILE: ConversationRoutingProfile = {
  conversationAction: COPILOT_CONVERSATION_ACTION,
  agentModel: COPILOT_AGENT_MODEL,
  provenanceSource: COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
  scopeName: "langwatch.ingestion.copilot_studio_dataverse",
  identityNamespace: "copilot_studio_dataverse",
};

/** Bot Framework roles, as they appear in the stored activities. */
const ROLE_AGENT = 0;
const ROLE_USER = 1;

/**
 * Both spellings of the role, because Bot Framework has two.
 *
 * Every activity in the capture carries the numeric form, so that is what the
 * fixtures use and what the mapper is built around. But `RoleTypes` in the SDK
 * is a string enum, and an activity that reached Dataverse through a different
 * channel can arrive spelled that way. Reading only the numbers would attribute
 * such a message to neither side and lose the turn.
 */
function roleOf(raw: unknown): number | null {
  if (raw === ROLE_USER || raw === ROLE_AGENT) return raw;
  if (typeof raw === "string") {
    const normalized = raw.toLowerCase();
    if (normalized === "user") return ROLE_USER;
    if (normalized === "bot") return ROLE_AGENT;
  }
  return null;
}

/**
 * Activity ids must be real GUIDs. The capture contains an activity whose id
 * is the string "0" and others with none at all, and both would seed a span
 * that either collides with a different turn or moves when the text changes.
 */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ActivityFrom {
  id?: string | null;
  role?: number | null;
  /** The only field naming a real directory account. Users only. */
  aadObjectId?: string | null;
  name?: string | null;
}

interface ToolCallValue {
  toolCallId?: string | null;
  toolName?: string | null;
  toolDisplayName?: string | null;
  toolCallStatus?: string | null;
  status?: string | null;
  filledParameters?: Record<string, unknown> | null;
}

interface Activity {
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
interface TranscriptRow {
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
interface BotFacts {
  botName?: string;
  /** When the agent was last changed. Later than the conversation = suspect. */
  modifiedOn?: string;
}

const MS_THRESHOLD = 1_000_000_000_000;

/** Bot Framework stamps seconds in `timestamp` and ms in `timestampMs`. */
function activityMs(activity: Activity): number | null {
  const ms = activity.timestampMs;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) return ms;
  const raw = activity.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw < MS_THRESHOLD ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function parseRow(event: NormalizedPullEvent): TranscriptRow | null {
  const row = asObject(event.raw_payload);
  return row ? (row as TranscriptRow) : null;
}

/**
 * The batch number, read from the metadata blob.
 *
 * Two things about it that a plain sort gets wrong. It lives inside a JSON
 * string rather than a column, so Dataverse cannot order or filter on it and
 * the merge has to happen here. And it is a number, so batches 2 and 10 sort
 * as 2 then 10 — sorting the values as text puts 10 first and silently
 * reorders a conversation.
 */
function batchIdOf(row: TranscriptRow): number | null {
  const metadata = asObject(row.metadata);
  const raw = metadata?.BatchId;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * What groups rows into one conversation: the stored name, used whole.
 *
 * The name happens to look like a conversation id and a bot id joined by an
 * underscore. Microsoft documents that as a shape they observed, not one they
 * promise, so splitting on the underscore would make our identifiers depend
 * on a format nobody committed to — and the failure would be silent, since a
 * name that stopped matching the shape would still produce *an* identifier,
 * just a different one, orphaning every conversation pulled before the change.
 *
 * The start time was part of this key and had to come out. Someone who leaves
 * a conversation idle past the session timeout and then keeps talking gets a
 * second row: same name, same batch number, a later start time. Keying on the
 * start time made that one conversation into two traces on two thread ids,
 * and the trace list showed only the newer half — which is exactly what the
 * whole `name` is for, since it already carries the conversation's own id.
 */
function conversationKeyOf(row: TranscriptRow): string | null {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  return name;
}

interface ConversationGroup {
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

/** True when the batch numbers held skip one, e.g. 0 and 2 with no 1. */
function hasBatchGap(batches: number[]): boolean {
  if (batches.length < 2) return false;
  const sorted = [...new Set(batches)].sort((a, b) => a - b);
  return sorted[sorted.length - 1]! - sorted[0]! !== sorted.length - 1;
}

/** One conversation's rows, with the agent facts seen alongside them. */
interface ConversationBucket {
  rows: { batchId: number | null; row: TranscriptRow }[];
  bot: BotFacts;
}

/** A row together with the position it arrived in, which breaks sort ties. */
interface IndexedRow {
  batchId: number | null;
  row: TranscriptRow;
  index: number;
}

/**
 * Take what this event knows about the agent.
 *
 * Bot facts repeat identically across a conversation's rows; the first row
 * that carries them wins, so a later batch missing the join does not erase
 * what an earlier one knew. A fact newly carried on the pulled event is read
 * across into `BotFacts` here.
 */
function rememberBotFacts(params: {
  bot: BotFacts;
  extra: Record<string, unknown>;
}): void {
  const { bot, extra } = params;
  if (!bot.botName && typeof extra.botName === "string") {
    bot.botName = extra.botName;
  }
  if (!bot.modifiedOn && typeof extra.botModifiedOn === "string") {
    bot.modifiedOn = extra.botModifiedOn;
  }
}

/** Bucket the run's rows by the conversation each belongs to. */
function bucketRowsByConversation(
  events: NormalizedPullEvent[],
): Map<string, ConversationBucket> {
  const byKey = new Map<string, ConversationBucket>();
  for (const event of events) {
    const row = parseRow(event);
    if (!row) continue;
    const key = conversationKeyOf(row);
    if (!key) continue;
    const existing = byKey.get(key) ?? { rows: [], bot: {} };
    existing.rows.push({ batchId: batchIdOf(row), row });
    rememberBotFacts({ bot: existing.bot, extra: event.extra ?? {} });
    byKey.set(key, existing);
  }
  return byKey;
}

/**
 * Batch order, then arrival order within a batch, with unbatched rows last.
 *
 * Returning 1 for both `(a,b)` and `(b,a)` when neither has a batch is an
 * inconsistent comparator, and what it decides is not "unspecified order" in
 * a harmless sense: turns are paired by walking the merged activities, so two
 * rows that swap put an answer before its question. Hence the arrival index.
 */
function byBatchThenArrival(a: IndexedRow, b: IndexedRow): number {
  if (a.batchId === null && b.batchId === null) return a.index - b.index;
  if (a.batchId === null) return 1;
  if (b.batchId === null) return -1;
  return a.batchId === b.batchId ? a.index - b.index : a.batchId - b.batchId;
}

/**
 * True for something that can be read as an activity.
 *
 * Each element is checked, not just the array. `content` is a JSON string the
 * row schema validates as a string and never opens, so this is the only place
 * anything looks inside it. A `null` element passes `Array.isArray` happily
 * and then throws on the first property read — and the caller has no
 * try/catch, so one malformed activity would take down routing for every
 * conversation in the run, not just its own.
 */
function isActivityObject(value: unknown): value is Activity {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Every activity these rows hold, in row order. */
function activitiesOf(rows: IndexedRow[]): Activity[] {
  const activities: Activity[] = [];
  for (const { row } of rows) {
    const list = asObject(row.content)?.activities;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (isActivityObject(entry)) activities.push(entry);
    }
  }
  return activities;
}

/**
 * The activities in time order, with an undateable one left where it lies.
 *
 * The dated activities are sorted among themselves and put back into the
 * slots dated activities already held, so an undateable one keeps its literal
 * position. Ranking them by comparator instead does not work: a rule that
 * compares null against a number by position and every other pair by time
 * contradicts itself — position says A before B, time says the reverse — and
 * a comparator that contradicts itself is answered with whatever the engine
 * likes. One undated activity was enough to leave the largest timestamp
 * sitting first, which is the exact failure this sort exists to prevent.
 */
function timeOrderActivities(activities: Activity[]): Activity[] {
  const sortable = activities.map((activity, index) => ({
    activity,
    index,
    ms: activityMs(activity),
  }));
  const dated: { activity: Activity; index: number; ms: number }[] = [];
  for (const item of sortable) {
    if (item.ms !== null) {
      dated.push({ activity: item.activity, index: item.index, ms: item.ms });
    }
  }
  dated.sort((a, b) => (a.ms === b.ms ? a.index - b.index : a.ms - b.ms));
  let nextDated = 0;
  return sortable.map((item) =>
    item.ms === null ? item.activity : dated[nextDated++]!.activity,
  );
}

/** True when the conversation happened while someone was building the agent. */
function isDesignModeConversation(activities: Activity[]): boolean {
  return activities.some(
    (a) =>
      a.valueType === "ConversationInfo" &&
      asObject(a.value)?.isDesignMode === true,
  );
}

/** One bucket's rows merged into the conversation they describe. */
function conversationGroupOf(params: {
  key: string;
  bucket: ConversationBucket;
}): ConversationGroup {
  const { key, bucket } = params;
  const ordered = bucket.rows
    .map((row, index) => ({ ...row, index }))
    .sort(byBatchThenArrival);
  const batches = ordered
    .map((r) => r.batchId)
    .filter((b): b is number => b !== null);
  const activities = activitiesOf(ordered);

  return {
    key,
    // Batch order, then time. Batch order alone is right whenever the rows
    // arrive as written, and this is what makes it right when they do not:
    // turns are paired by walking this list, so one out-of-order message
    // attaches an answer to the wrong question.
    activities: timeOrderActivities(activities),
    bot: bucket.bot,
    batches,
    // A hole in the batch numbers we hold — 0 and 2 with no 1 — is a piece
    // of the conversation that is genuinely missing. It still routes, a
    // partial transcript beating none, but it is marked so nobody reads it
    // as the whole exchange.
    //
    // Deliberately not "batch 0 is absent", which was the first rule here
    // and is wrong for an ordinary reason: batches carry different
    // `createdon` values, so a pull window can end between them. The run
    // holding only batch 1 would flag a conversation whose opening arrived
    // perfectly well on the previous run. The cost of the narrower rule is
    // that a conversation truncated at the front by the 30-day cleanup
    // reads as complete; `transcript_batches` still shows how many pieces
    // this is built from.
    isIncomplete: hasBatchGap(batches),
    isDesignMode: isDesignModeConversation(activities),
  };
}

/**
 * Group rows into conversations and merge their activity lists.
 *
 * Rows arrive in whatever order the pull produced. Batches are applied in
 * numeric order; a row with no batch number sorts last rather than being
 * dropped, because a conversation missing part of itself is still worth
 * showing.
 */
export function groupTranscriptRows(
  events: NormalizedPullEvent[],
): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  for (const [key, bucket] of bucketRowsByConversation(events)) {
    groups.push(conversationGroupOf({ key, bucket }));
  }
  return groups;
}

/** A user question paired with the agent's reply, if it gave one. */
interface Turn {
  /** The activity whose GUID seeds this turn's span. */
  seedActivityId: string;
  question: string | null;
  answer: string | null;
  /** Directory account of the person who asked; absent for agent-only turns. */
  authorAadObjectId: string | null;
  startMs: number;
  endMs: number;
}

function textOf(activity: Activity): string {
  return typeof activity.text === "string" ? activity.text.trim() : "";
}

/** A message activity that is identified, dated, and actually said something. */
interface ReadableMessage {
  id: string;
  ms: number;
  text: string;
  role: number | null;
  /** Directory account of the speaker; only user messages carry one. */
  aadObjectId: string | null;
}

/**
 * A message a turn can be built from, or null.
 *
 * Never invented: a message with no GUID and a message that cannot be dated
 * are both rejected here rather than given a made-up identity or the clock.
 */
function readableMessage(activity: Activity): ReadableMessage | null {
  const id = typeof activity.id === "string" ? activity.id : "";
  const ms = activityMs(activity);
  const text = textOf(activity);
  if (!GUID.test(id) || ms === null || !text) return null;

  const aad = activity.from?.aadObjectId;
  return {
    id,
    ms,
    text,
    role: roleOf(activity.from?.role),
    // `from.id` is deliberately not consulted. It is GUID-shaped and looks
    // like an account, but it is per-conversation and naming a person by it
    // would invent one person per conversation.
    aadObjectId: typeof aad === "string" && aad ? aad : null,
  };
}

/** What pairing a conversation's messages into turns has built so far. */
interface TurnAccumulator {
  turns: Turn[];
  open: Turn | null;
  skipped: number;
}

function closeTurn(state: TurnAccumulator): void {
  if (state.open) state.turns.push(state.open);
  state.open = null;
}

/**
 * Fold one message into the turns built so far.
 *
 * A user message opens a turn and the agent messages that follow close it.
 * An agent message with no user message before it is its own turn — the agent
 * greets first, and dropping that would lose the opening line of most
 * conversations.
 */
function applyMessage(params: {
  state: TurnAccumulator;
  message: ReadableMessage;
}): void {
  const { state, message } = params;

  if (message.role === ROLE_USER) {
    closeTurn(state);
    state.open = {
      seedActivityId: message.id,
      question: message.text,
      answer: null,
      authorAadObjectId: message.aadObjectId,
      startMs: message.ms,
      endMs: message.ms,
    };
    return;
  }

  if (message.role === ROLE_AGENT) {
    const open = state.open;
    if (open) {
      open.answer = open.answer
        ? `${open.answer}\n\n${message.text}`
        : message.text;
      open.endMs = Math.max(open.endMs, message.ms);
      return;
    }
    state.turns.push({
      seedActivityId: message.id,
      question: null,
      answer: message.text,
      authorAadObjectId: null,
      startMs: message.ms,
      endMs: message.ms,
    });
    return;
  }

  // Said something, cannot be attributed to either side. Counting it is the
  // whole point: the alternative is a conversation whose every message has
  // an unreadable role producing no turns at all, which reaches
  // `assembleTraceRequest` as an empty span list and disappears with no
  // log, no attribute and no error — indistinguishable from a pull that
  // found nothing.
  state.skipped += 1;
}

/**
 * Pair message activities into turns.
 *
 * Skipped and counted, never invented: a message with no GUID, and a message
 * that cannot be dated.
 */
export function turnsOf(activities: Activity[]): {
  turns: Turn[];
  skipped: number;
} {
  const state: TurnAccumulator = { turns: [], open: null, skipped: 0 };

  for (const activity of activities) {
    if (activity.type !== "message") continue;
    const message = readableMessage(activity);
    if (!message) {
      // A message with nothing said is not a skip worth counting — there is
      // no turn being lost. A message that said something but cannot be
      // identified or dated is.
      if (textOf(activity)) state.skipped += 1;
      continue;
    }
    applyMessage({ state, message });
  }

  closeTurn(state);
  return { turns: state.turns, skipped: state.skipped };
}

interface ToolCall {
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
interface ToolCallTrace {
  /** What pairs a start with its completion. */
  callId: string;
  seedActivityId: string;
  name: string;
  arguments: string | null;
  ms: number;
  isCompleted: boolean;
}

/** The most human of the names the trace carries. */
function toolNameOf(value: ToolCallValue): string {
  return (
    (typeof value.toolDisplayName === "string" && value.toolDisplayName) ||
    (typeof value.toolName === "string" && value.toolName) ||
    "tool"
  );
}

/**
 * What pairs a start with its completion: the call id when the trace names
 * one, and otherwise the activity's own id, which pairs it with nothing and
 * so stands alone.
 */
function callIdOf(params: {
  value: ToolCallValue;
  activityId: string;
}): string {
  const { value, activityId } = params;
  return typeof value.toolCallId === "string" && value.toolCallId
    ? value.toolCallId
    : activityId;
}

/**
 * One tool-call trace, or null when the activity is not one or cannot be
 * identified or dated.
 */
function toolCallTraceOf(activity: Activity): ToolCallTrace | null {
  if (activity.type !== "event") return null;
  if (!(activity.name ?? "").startsWith("ToolCallTrace:")) return null;

  const id = typeof activity.id === "string" ? activity.id : "";
  const ms = activityMs(activity);
  if (!GUID.test(id) || ms === null) return null;

  const value = (asObject(activity.value) ?? {}) as ToolCallValue;
  return {
    callId: callIdOf({ value, activityId: id }),
    seedActivityId: id,
    name: toolNameOf(value),
    arguments: value.filledParameters
      ? JSON.stringify(value.filledParameters)
      : null,
    ms,
    isCompleted: (value.toolCallStatus ?? "").toLowerCase() === "completed",
  };
}

export function toolCallsOf(activities: Activity[]): ToolCall[] {
  const byCallId = new Map<string, ToolCall>();
  for (const activity of activities) {
    const trace = toolCallTraceOf(activity);
    if (!trace) continue;

    const existing = byCallId.get(trace.callId);
    if (existing) {
      // The first trace for a call seeds it, and that is safe here only
      // because of what runs before: this walks `group.activities`, which is
      // already time-ordered, and `toolCallTraceOf` refuses any trace it
      // cannot date. An undated trace therefore never reaches this map, and
      // among dated ones the earliest is always seen first — so the seed is
      // the start, never a completion that happened to be stored above it.
      existing.endMs = Math.max(existing.endMs, trace.ms);
      if (trace.isCompleted) existing.isFinished = true;
      continue;
    }
    byCallId.set(trace.callId, {
      seedActivityId: trace.seedActivityId,
      name: trace.name,
      arguments: trace.arguments,
      startMs: trace.ms,
      endMs: trace.ms,
      isFinished: trace.isCompleted,
    });
  }
  return [...byCallId.values()].sort((a, b) => a.startMs - b.startMs);
}

function chatValue(role: string, content: string): string {
  return JSON.stringify({
    type: "chat_messages",
    value: [{ role, content }],
  });
}

/**
 * Whether the agent was edited after this conversation happened.
 *
 * The transcript records what was said, never which configuration said it, so
 * the agent this trace names is the agent as it stands now. When it was last
 * changed after the conversation ended, "now" and "then" are not the same
 * agent, and anyone reading this trace as evidence of how the agent behaves
 * needs to know that before they draw a conclusion from it.
 */
function agentChangedSince(bot: BotFacts, conversationEndMs: number): boolean {
  if (!bot.modifiedOn) return false;
  const modified = Date.parse(bot.modifiedOn);
  return Number.isFinite(modified) && modified > conversationEndMs;
}

function conversationAttrs(params: {
  origin: RoutingOrigin;
  group: ConversationGroup;
  endMs: number;
  skipped: number;
  threadId: string;
}): OtlpJsonAttr[] {
  const { origin, group, endMs, skipped, threadId } = params;
  const attrs: OtlpJsonAttr[] = [
    stringAttr({ key: "langwatch.thread.id", value: threadId }),
    ...originAttrs(origin),
  ];
  if (group.bot.botName) {
    attrs.push(
      stringAttr({
        key: "copilot_studio.agent_name",
        value: group.bot.botName,
      }),
    );
  }
  if (agentChangedSince(group.bot, endMs)) {
    attrs.push(
      stringAttr({ key: "copilot_studio.agent_changed_since", value: "true" }),
    );
  }
  if (group.batches.length > 0) {
    attrs.push(
      stringAttr({
        key: "copilot_studio.transcript_batches",
        value: group.batches.join(","),
      }),
    );
  }
  if (group.isIncomplete) {
    attrs.push(
      stringAttr({
        key: "copilot_studio.conversation_incomplete",
        value: "true",
      }),
    );
  }
  if (group.isDesignMode) {
    // The conversation happened while someone was building the agent rather
    // than using it. Recorded and labelled instead of filtered, because the
    // person testing their agent is exactly who wants to read the transcript.
    attrs.push(
      stringAttr({ key: "copilot_studio.design_mode", value: "true" }),
    );
  }
  if (skipped > 0) {
    attrs.push(
      intAttr({ key: "copilot_studio.activities_skipped", value: skipped }),
    );
  }
  return attrs;
}

function turnSpan(params: {
  origin: RoutingOrigin;
  group: ConversationGroup;
  turn: Turn;
  traceId: string;
  parentSpanId: string;
  threadId: string;
  spanSeed: string;
  skipped: number;
  conversationEndMs: number;
}): OtlpJsonSpan {
  const {
    origin,
    group,
    turn,
    traceId,
    parentSpanId,
    threadId,
    spanSeed,
    skipped,
    conversationEndMs,
  } = params;
  const attrs: OtlpJsonAttr[] = [
    stringAttr({ key: "langwatch.span.type", value: "llm" }),
    ...conversationAttrs({
      origin,
      group,
      endMs: conversationEndMs,
      skipped,
      threadId,
    }),
    stringAttr({
      key: "gen_ai.request.model",
      value: origin.profile.agentModel,
    }),
  ];
  if (turn.question !== null) {
    attrs.push(
      stringAttr({
        key: "langwatch.input",
        value: chatValue("user", turn.question),
      }),
    );
  }
  if (turn.answer !== null) {
    attrs.push(
      stringAttr({
        key: "langwatch.output",
        value: chatValue("assistant", turn.answer),
      }),
    );
  }
  if (turn.authorAadObjectId) {
    // The raw directory identifier, never resolved to a name at pull time.
    // Resolving it would mean asking for a directory permission this source
    // otherwise does not need.
    attrs.push(
      stringAttr({ key: "langwatch.user.id", value: turn.authorAadObjectId }),
    );
  }
  return {
    traceId,
    spanId: hashId(`${spanSeed}:${turn.seedActivityId}`, 16),
    parentSpanId,
    name: COPILOT_TURN_SPAN_NAME,
    kind: 1,
    startTimeUnixNano: msToNano(turn.startMs),
    endTimeUnixNano: msToNano(Math.max(turn.endMs, turn.startMs)),
    attributes: attrs,
    status: { code: 1 },
  };
}

function toolSpan(params: {
  origin: RoutingOrigin;
  call: ToolCall;
  traceId: string;
  parentSpanId: string;
  spanSeed: string;
}): OtlpJsonSpan {
  const { origin, call, traceId, parentSpanId, spanSeed } = params;
  const attrs: OtlpJsonAttr[] = [
    stringAttr({ key: "langwatch.span.type", value: "tool" }),
    stringAttr({ key: "tool_name", value: call.name }),
    ...originAttrs(origin),
  ];
  if (call.arguments) {
    attrs.push(stringAttr({ key: "full_command", value: call.arguments }));
  }
  if (!call.isFinished) {
    // The tool started and never reported finishing. Common enough that the
    // validation script calls it normal, so it renders marked rather than
    // being held back or dropped.
    attrs.push(
      stringAttr({ key: "copilot_studio.tool_call_unfinished", value: "true" }),
    );
  }
  return {
    traceId,
    spanId: hashId(`${spanSeed}:${call.seedActivityId}`, 16),
    parentSpanId,
    name: COPILOT_TOOL_SPAN_NAME,
    kind: 1,
    startTimeUnixNano: msToNano(call.startMs),
    endTimeUnixNano: msToNano(Math.max(call.endMs, call.startMs)),
    attributes: attrs,
    status: { code: 1 },
  };
}

/**
 * The single span every turn in one conversation hangs under.
 *
 * A trace's headline is folded across its root spans, so a conversation whose
 * turns were each a root showed only whichever turn the fold read last. One
 * chain span per conversation gives the fold one place to read, and it carries
 * the arc: the first thing asked and the last thing answered.
 */
function conversationSpan(params: {
  origin: RoutingOrigin;
  group: ConversationGroup;
  turns: Turn[];
  traceId: string;
  spanId: string;
  threadId: string;
  skipped: number;
  conversationEndMs: number;
  /**
   * The span's own bounds, which are NOT the conversation's.
   *
   * `conversationEndMs` answers "when did this conversation happen", and is
   * what decides whether the agent was edited afterwards — a question about
   * turns. These two answer "what time range does this span have to cover",
   * and a tool call hanging under a turn can start before the first turn or
   * end after the last, so they take the extremes across every span emitted
   * under this one. A parent that does not contain its children is a trace
   * the explorer renders wrong.
   */
  spanStartMs: number;
  spanEndMs: number;
}): OtlpJsonSpan {
  const {
    origin,
    group,
    turns,
    traceId,
    spanId,
    threadId,
    skipped,
    conversationEndMs,
    spanStartMs,
    spanEndMs,
  } = params;

  const firstQuestion = turns.find((turn) => turn.question !== null)?.question;
  const lastAnswer = [...turns]
    .reverse()
    .find((turn) => turn.answer !== null)?.answer;

  const attributes: OtlpJsonAttr[] = [
    stringAttr({ key: "langwatch.span.type", value: "chain" }),
    ...conversationAttrs({
      origin,
      group,
      endMs: conversationEndMs,
      skipped,
      threadId,
    }),
  ];
  if (firstQuestion) {
    attributes.push(
      stringAttr({
        key: "langwatch.input",
        value: chatValue("user", firstQuestion),
      }),
    );
  }
  if (lastAnswer) {
    attributes.push(
      stringAttr({
        key: "langwatch.output",
        value: chatValue("assistant", lastAnswer),
      }),
    );
  }

  return {
    traceId,
    spanId,
    name: COPILOT_CONVERSATION_SPAN_NAME,
    kind: 1,
    startTimeUnixNano: msToNano(spanStartMs),
    endTimeUnixNano: msToNano(spanEndMs),
    attributes,
    status: { code: 1 },
  };
}

/**
 * Map one run's pulled transcript rows to a single OTLP trace request.
 * Returns null when nothing routes.
 *
 * The action filter is the last guard between a source's events and a
 * customer's trace project: the routing step runs for every source and this
 * mapper will build a span for whatever it is handed. Without the filter, a
 * source of some other kind that acquired a destination would have its rows
 * rendered as things people said.
 */
/**
 * Every span one conversation contributes: the chain span its turns hang
 * under, one span per turn, and one per tool call.
 *
 * Empty when the group produced no turns — a row of pure bookkeeping routes
 * nothing rather than routing an empty conversation.
 */
function conversationSpans(params: {
  origin: RoutingOrigin;
  group: ConversationGroup;
}): OtlpJsonSpan[] {
  const { origin, group } = params;
  const { turns, skipped } = turnsOf(group.activities);
  if (turns.length === 0) return [];

  const seeds: ConversationSeeds = {
    // A Copilot trace is the whole conversation, so the conversation key
    // alone names it — unlike Genie, where a trace is one question.
    trace: [group.key],
    thread: [group.key],
    span: [group.key],
  };
  const identity = deriveConversationIdentity(origin, seeds);
  const conversationEndMs = turns.reduce(
    (latest, turn) => Math.max(latest, turn.endMs),
    turns[0]!.startMs,
  );

  // Read before the root span is built, because the root has to cover them: a
  // call hanging under a turn can start before the first turn began or run
  // past the last one's end.
  const calls = toolCallsOf(group.activities);
  const spanStartMs = calls.reduce(
    (earliest, call) => Math.min(earliest, call.startMs),
    turns[0]!.startMs,
  );
  const spanEndMs = calls.reduce(
    (latest, call) => Math.max(latest, call.endMs),
    conversationEndMs,
  );

  const spans: OtlpJsonSpan[] = [
    conversationSpan({
      origin,
      group,
      turns,
      traceId: identity.traceId,
      spanId: identity.rootSpanId,
      threadId: identity.threadId,
      skipped,
      conversationEndMs,
      spanStartMs,
      spanEndMs,
    }),
  ];

  for (const turn of turns) {
    spans.push(
      turnSpan({
        origin,
        group,
        turn,
        traceId: identity.traceId,
        parentSpanId: identity.rootSpanId,
        threadId: identity.threadId,
        spanSeed: identity.spanSeed,
        skipped,
        conversationEndMs,
      }),
    );
  }

  spans.push(...toolSpansOf({ origin, calls, turns, identity }));

  return spans;
}

/**
 * One span per tool call, each hanging off the turn it falls inside by time.
 * A call that predates every turn hangs off the first one rather than being
 * dropped.
 */
function toolSpansOf(params: {
  origin: RoutingOrigin;
  calls: ToolCall[];
  turns: Turn[];
  identity: ReturnType<typeof deriveConversationIdentity>;
}): OtlpJsonSpan[] {
  const { origin, calls, turns, identity } = params;
  return calls.map((call) => {
    const parent =
      [...turns].reverse().find((turn) => turn.startMs <= call.startMs) ??
      turns[0]!;
    return toolSpan({
      origin,
      call,
      traceId: identity.traceId,
      parentSpanId: hashId(`${identity.spanSeed}:${parent.seedActivityId}`, 16),
      spanSeed: identity.spanSeed,
    });
  });
}

export function mapCopilotEventsToTraceRequest({
  events,
  origin,
}: {
  events: NormalizedPullEvent[];
  origin: RoutingOrigin;
}): IExportTraceServiceRequest | null {
  const wanted = origin.profile.conversationAction;
  const conversationEvents = (wanted ? events : []).filter(
    (event) => !!event.action && event.action === wanted,
  );

  const spans = groupTranscriptRows(conversationEvents).flatMap((group) =>
    conversationSpans({ origin, group }),
  );

  return assembleTraceRequest(spans, origin.profile);
}
