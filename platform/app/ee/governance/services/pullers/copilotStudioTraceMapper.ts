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
 * What groups rows into one conversation: the stored name together with the
 * conversation's start time, both used whole.
 *
 * The name happens to look like a conversation id and a bot id joined by an
 * underscore. Microsoft documents that as a shape they observed, not one they
 * promise, so splitting on the underscore would make our identifiers depend
 * on a format nobody committed to — and the failure would be silent, since a
 * name that stopped matching the shape would still produce *an* identifier,
 * just a different one, orphaning every conversation pulled before the change.
 */
function conversationKeyOf(row: TranscriptRow): string | null {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const start =
    typeof row.conversationstarttime === "string"
      ? row.conversationstarttime.trim()
      : "";
  if (!name || !start) return null;
  return `${name}|${start}`;
}

interface ConversationGroup {
  key: string;
  activities: Activity[];
  bot: BotFacts;
  /** Batch numbers seen, in the order applied. */
  batches: number[];
  /** True when the opening batch is absent, so the start is missing. */
  incomplete: boolean;
  /** True when the conversation happened while designing the agent. */
  designMode: boolean;
}

/** True when the batch numbers held skip one, e.g. 0 and 2 with no 1. */
function hasBatchGap(batches: number[]): boolean {
  if (batches.length < 2) return false;
  const sorted = [...new Set(batches)].sort((a, b) => a - b);
  return sorted[sorted.length - 1]! - sorted[0]! !== sorted.length - 1;
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
  const byKey = new Map<
    string,
    { rows: { batchId: number | null; row: TranscriptRow }[]; bot: BotFacts }
  >();

  for (const event of events) {
    const row = parseRow(event);
    if (!row) continue;
    const key = conversationKeyOf(row);
    if (!key) continue;
    const existing = byKey.get(key) ?? { rows: [], bot: {} };
    existing.rows.push({ batchId: batchIdOf(row), row });
    // Bot facts repeat identically across a conversation's rows; the first
    // row that carries them wins, so a later batch missing the join does not
    // erase what an earlier one knew.
    const extra = event.extra ?? {};
    if (!existing.bot.botName && typeof extra.botName === "string") {
      existing.bot.botName = extra.botName;
    }
    if (!existing.bot.modifiedOn && typeof extra.botModifiedOn === "string") {
      existing.bot.modifiedOn = extra.botModifiedOn;
    }
    byKey.set(key, existing);
  }

  const groups: ConversationGroup[] = [];
  for (const [key, entry] of byKey) {
    // Unbatched rows sort last and hold their arrival order among themselves.
    // Returning 1 for both `(a,b)` and `(b,a)` when neither has a batch is an
    // inconsistent comparator, and what it decides is not "unspecified order"
    // in a harmless sense: turns are paired by walking the merged activities,
    // so two rows that swap put an answer before its question.
    const withIndex = entry.rows.map((row, index) => ({ ...row, index }));
    const ordered = withIndex.sort((a, b) => {
      if (a.batchId === null && b.batchId === null) return a.index - b.index;
      if (a.batchId === null) return 1;
      if (b.batchId === null) return -1;
      return a.batchId === b.batchId
        ? a.index - b.index
        : a.batchId - b.batchId;
    });
    const batches = ordered
      .map((r) => r.batchId)
      .filter((b): b is number => b !== null);
    const activities: Activity[] = [];
    for (const { row } of ordered) {
      const content = asObject(row.content);
      const list = content?.activities;
      if (!Array.isArray(list)) continue;
      // Each element is checked, not just the array. `content` is a JSON
      // string the row schema validates as a string and never opens, so this
      // is the only place anything looks inside it. A `null` element passes
      // `Array.isArray` happily and then throws on the first property read —
      // and the caller has no try/catch, so one malformed activity would take
      // down routing for every conversation in the run, not just its own.
      for (const entry of list) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          activities.push(entry as Activity);
        }
      }
    }
    // Batch order, then time. Batch order alone is right whenever the rows
    // arrive as written, and this is what makes it right when they do not:
    // turns are paired by walking this list, so one out-of-order message
    // attaches an answer to the wrong question. Undateable activities keep
    // their position rather than being bunched at one end — the sort is
    // stable, and a missing timestamp is not evidence about ordering.
    const sortable = activities.map((activity, index) => ({
      activity,
      index,
      ms: activityMs(activity),
    }));
    sortable.sort((a, b) => {
      if (a.ms === null || b.ms === null) return a.index - b.index;
      return a.ms === b.ms ? a.index - b.index : a.ms - b.ms;
    });
    groups.push({
      key,
      activities: sortable.map((s) => s.activity),
      bot: entry.bot,
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
      incomplete: hasBatchGap(batches),
      designMode: activities.some(
        (a) =>
          a.valueType === "ConversationInfo" &&
          asObject(a.value)?.isDesignMode === true,
      ),
    });
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

/**
 * Pair message activities into turns.
 *
 * A user message opens a turn and the agent messages that follow close it.
 * An agent message with no user message before it is its own turn — the
 * agent greets first, and dropping that would lose the opening line of most
 * conversations.
 *
 * Skipped and counted, never invented: a message with no GUID, and a message
 * that cannot be dated.
 */
export function turnsOf(activities: Activity[]): {
  turns: Turn[];
  skipped: number;
} {
  const messages = activities.filter((a) => a.type === "message");
  const turns: Turn[] = [];
  let skipped = 0;
  let open: Turn | null = null;

  const close = () => {
    if (open) turns.push(open);
    open = null;
  };

  for (const activity of messages) {
    const id = typeof activity.id === "string" ? activity.id : "";
    const ms = activityMs(activity);
    const text = textOf(activity);
    if (!GUID.test(id) || ms === null || !text) {
      // A message with nothing said is not a skip worth counting — there is
      // no turn being lost. A message that said something but cannot be
      // identified or dated is.
      if (text) skipped += 1;
      continue;
    }
    const role = roleOf(activity.from?.role);
    if (role === ROLE_USER) {
      close();
      const aad = activity.from?.aadObjectId;
      open = {
        seedActivityId: id,
        question: text,
        answer: null,
        // `from.id` is deliberately not consulted. It is GUID-shaped and
        // looks like an account, but it is per-conversation and naming a
        // person by it would invent one person per conversation.
        authorAadObjectId: typeof aad === "string" && aad ? aad : null,
        startMs: ms,
        endMs: ms,
      };
      continue;
    }
    if (role === ROLE_AGENT) {
      if (open) {
        open.answer = open.answer ? `${open.answer}\n\n${text}` : text;
        open.endMs = Math.max(open.endMs, ms);
        continue;
      }
      turns.push({
        seedActivityId: id,
        question: null,
        answer: text,
        authorAadObjectId: null,
        startMs: ms,
        endMs: ms,
      });
      continue;
    }
    // Said something, cannot be attributed to either side. Counting it is the
    // whole point: the alternative is a conversation whose every message has
    // an unreadable role producing no turns at all, which reaches
    // `assembleTraceRequest` as an empty span list and disappears with no
    // log, no attribute and no error — indistinguishable from a pull that
    // found nothing.
    skipped += 1;
  }
  close();
  return { turns, skipped };
}

interface ToolCall {
  seedActivityId: string;
  name: string;
  arguments: string | null;
  startMs: number;
  endMs: number;
  finished: boolean;
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
export function toolCallsOf(activities: Activity[]): ToolCall[] {
  const byCallId = new Map<string, ToolCall>();
  for (const activity of activities) {
    if (activity.type !== "event") continue;
    const name = activity.name ?? "";
    if (!name.startsWith("ToolCallTrace:")) continue;
    const id = typeof activity.id === "string" ? activity.id : "";
    const ms = activityMs(activity);
    if (!GUID.test(id) || ms === null) continue;
    const value = (asObject(activity.value) ?? {}) as ToolCallValue;
    const callId =
      typeof value.toolCallId === "string" && value.toolCallId
        ? value.toolCallId
        : id;
    const status = (value.toolCallStatus ?? "").toLowerCase();
    const existing = byCallId.get(callId);
    if (existing) {
      existing.endMs = Math.max(existing.endMs, ms);
      if (status === "completed") existing.finished = true;
      continue;
    }
    byCallId.set(callId, {
      seedActivityId: id,
      name:
        (typeof value.toolDisplayName === "string" && value.toolDisplayName) ||
        (typeof value.toolName === "string" && value.toolName) ||
        "tool",
      arguments: value.filledParameters
        ? JSON.stringify(value.filledParameters)
        : null,
      startMs: ms,
      endMs: ms,
      finished: status === "completed",
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
    stringAttr("langwatch.thread.id", threadId),
    ...originAttrs(origin),
  ];
  if (group.bot.botName) {
    attrs.push(stringAttr("copilot_studio.agent_name", group.bot.botName));
  }
  if (agentChangedSince(group.bot, endMs)) {
    attrs.push(stringAttr("copilot_studio.agent_changed_since", "true"));
  }
  if (group.batches.length > 0) {
    attrs.push(
      stringAttr("copilot_studio.transcript_batches", group.batches.join(",")),
    );
  }
  if (group.incomplete) {
    attrs.push(stringAttr("copilot_studio.conversation_incomplete", "true"));
  }
  if (group.designMode) {
    // The conversation happened while someone was building the agent rather
    // than using it. Recorded and labelled instead of filtered, because the
    // person testing their agent is exactly who wants to read the transcript.
    attrs.push(stringAttr("copilot_studio.design_mode", "true"));
  }
  if (skipped > 0) {
    attrs.push(intAttr("copilot_studio.activities_skipped", skipped));
  }
  return attrs;
}

function turnSpan(params: {
  origin: RoutingOrigin;
  group: ConversationGroup;
  turn: Turn;
  traceId: string;
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
    threadId,
    spanSeed,
    skipped,
    conversationEndMs,
  } = params;
  const attrs: OtlpJsonAttr[] = [
    stringAttr("langwatch.span.type", "llm"),
    ...conversationAttrs({
      origin,
      group,
      endMs: conversationEndMs,
      skipped,
      threadId,
    }),
    stringAttr("gen_ai.request.model", origin.profile.agentModel),
  ];
  if (turn.question !== null) {
    attrs.push(stringAttr("langwatch.input", chatValue("user", turn.question)));
  }
  if (turn.answer !== null) {
    attrs.push(
      stringAttr("langwatch.output", chatValue("assistant", turn.answer)),
    );
  }
  if (turn.authorAadObjectId) {
    // The raw directory identifier, never resolved to a name at pull time.
    // Resolving it would mean asking for a directory permission this source
    // otherwise does not need.
    attrs.push(stringAttr("langwatch.user.id", turn.authorAadObjectId));
  }
  return {
    traceId,
    spanId: hashId(`${spanSeed}:${turn.seedActivityId}`, 16),
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
    stringAttr("langwatch.span.type", "tool"),
    stringAttr("tool_name", call.name),
    ...originAttrs(origin),
  ];
  if (call.arguments) {
    attrs.push(stringAttr("full_command", call.arguments));
  }
  if (!call.finished) {
    // The tool started and never reported finishing. Common enough that the
    // validation script calls it normal, so it renders marked rather than
    // being held back or dropped.
    attrs.push(stringAttr("copilot_studio.tool_call_unfinished", "true"));
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
 * Map one run's pulled transcript rows to a single OTLP trace request.
 * Returns null when nothing routes.
 *
 * The action filter is the last guard between a source's events and a
 * customer's trace project: the routing step runs for every source and this
 * mapper will build a span for whatever it is handed. Without the filter, a
 * source of some other kind that acquired a destination would have its rows
 * rendered as things people said.
 */
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
  const spans: OtlpJsonSpan[] = [];

  for (const group of groupTranscriptRows(conversationEvents)) {
    const { turns, skipped } = turnsOf(group.activities);
    if (turns.length === 0) continue;

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

    for (const turn of turns) {
      spans.push(
        turnSpan({
          origin,
          group,
          turn,
          traceId: identity.traceId,
          threadId: identity.threadId,
          spanSeed: identity.spanSeed,
          skipped,
          conversationEndMs,
        }),
      );
    }

    // Tool calls hang off the turn they fall inside, by time. A call that
    // predates every turn hangs off the first one rather than being dropped.
    const calls = toolCallsOf(group.activities);
    for (const call of calls) {
      const parent =
        [...turns].reverse().find((turn) => turn.startMs <= call.startMs) ??
        turns[0]!;
      spans.push(
        toolSpan({
          origin,
          call,
          traceId: identity.traceId,
          parentSpanId: hashId(
            `${identity.spanSeed}:${parent.seedActivityId}`,
            16,
          ),
          spanSeed: identity.spanSeed,
        }),
      );
    }
  }

  return assembleTraceRequest(spans, origin.profile);
}
