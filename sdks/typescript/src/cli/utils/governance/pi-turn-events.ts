/**
 * Turning one parsed pi session into the records LangWatch ingests.
 *
 * Rung 8 (`pi-session-file.ts`) reads the file into rows. This turns those rows
 * into OTLP **log records** — events, not spans — and nothing else: it opens no
 * file, dials nothing, and de-duplicates nothing. The transport is the shared
 * one in `agent-rollout-transport.ts`.
 *
 * Five decisions are load-bearing enough to state here. The first four were
 * measured against a real 132-row session; the fifth is built to pi's documented
 * format, because the shapes it covers were not in any session on this machine.
 *
 * **Events, not spans.** pi's file is a sequence of messages with no trace or
 * span ids. Emitting spans would mean inventing parentage pi never gave us, so
 * the server-side definition marks pi `logsOnly` and folds its model calls and
 * tool runs from these events (`agents/pi.ts`). The codex path next door emits
 * spans because codex hands us its own trace ids; pi hands us none.
 *
 * **One clock: the entry's.** Every row carries two timestamps of two different
 * types — an ISO string on the entry, unix milliseconds on the message — and
 * they are not the same instant. On the measured session the message clock runs
 * up to 123.5 seconds BEHIND the entry clock (an assistant row is stamped when
 * the turn began; the entry is appended when the reply landed). Both are
 * monotonic in file order, so either would order the session correctly on its
 * own — but MIXING them would not, and the entry clock is the only one present
 * on every row kind (`model_change` and `compaction` carry no message). So the
 * entry timestamp is the event time everywhere, and the message clock is the
 * fallback for a row whose entry timestamp is missing or unparseable.
 *
 * **pi is the agent; the provider is an attribute of a pi turn.** The measured
 * session was answered by two different providers and changed model three
 * times. Every record here names pi in the places identity is read from — the
 * resource `service.name`, the scope, the `pi.` name prefix — and names the
 * provider only in `gen_ai.provider.name`, which nothing detects on. ADR-132 §4.
 *
 * **Absent is not zero.** `PiCost` makes an unreported cost a variant with no
 * `total`, so `?? 0` does not compile. That is preserved here by branching on
 * `cost.reported`: a turn pi charged nothing for carries `cost_usd: 0`, and a
 * turn pi reported no cost for carries no `cost_usd` attribute at all. The two
 * are different facts and the wire keeps them apart.
 *
 * **Money only ever rides `api_request`.** pi bills three kinds of row and the
 * session fold reads a cost off one event name, so a billed tool result and a
 * billed summary each emit their own `api_request` alongside the record of what
 * they were — see {@link billedWorkEvent}. A `cost_usd` anywhere else is a
 * number that passes this file's tests and reaches the product as zero.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import type { PiRow, PiSession, PiTokens } from "./pi-session-file";
import type { PiLineage } from "./pi-session-lineage";

/** What we call pi everywhere identity is read: resource, scope and name prefix. */
export const PI_AGENT_ID = "pi";

/**
 * The resource `service.name` on every pi record, and the exact string
 * `agents/pi.ts` matches on. Exact, not a substring test: `pi` sits inside both
 * `anthropic` and `copilot`.
 */
export const PI_SERVICE_NAME = "pi";

/**
 * The instrumentation scope. A `langwatch.` name because this signal is
 * entirely ours — pi exports no telemetry of its own, so there is no vendor
 * scope to imitate, and imitating one would be a lie about where the data came
 * from.
 */
export const PI_EVENT_SCOPE = "langwatch.pi.session";

/** INFO, from the OTel log data model severity numbers. */
const SEVERITY_INFO = 9;

/**
 * The event names, namespaced `pi.` so the pipeline strips the prefix and lands
 * each one on the shared vocabulary (`agents/pi.ts` declares the prefix,
 * `coding-agent-normalization.ts` strips it).
 */
export const PI_EVENT = {
  USER_PROMPT: "pi.user_prompt",
  API_REQUEST: "pi.api_request",
  TOOL_RESULT: "pi.tool_result",
} as const;

/** A scalar attribute value, before OTLP encoding. */
export type PiAttributeValue = string | number | boolean;

/**
 * One event, before it becomes OTLP. The intermediate exists so the ordering
 * and cost decisions above are assertable without reading through a wire
 * encoding, and so a later rung can de-duplicate on something smaller than a
 * payload.
 */
export interface PiTurnEvent {
  /** The namespaced event name, one of {@link PI_EVENT}. */
  readonly name: string;
  /** The entry clock, in unix milliseconds. See the module note on clocks. */
  readonly timeUnixMs: number;
  readonly attributes: Readonly<Record<string, PiAttributeValue>>;
}

/**
 * Attributes that are money and must stay floating point on the wire even when
 * their value happens to be a whole number. Without this a zero cost would
 * encode as an integer and a fractional one as a double, which is the same
 * field changing type between two records of the same kind.
 */
const DOUBLE_VALUED_ATTRIBUTES: ReadonlySet<string> = new Set(["cost_usd"]);

/** The text a row's content carries, for the length attributes. Never the text itself. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      "text" in block &&
      typeof (block as { text: unknown }).text === "string"
    ) {
      out += (block as { text: string }).text;
    }
  }
  return out;
}

/**
 * When this row happened, in unix milliseconds.
 *
 * The entry's ISO timestamp first, the message's unix milliseconds only as a
 * fallback — see the module note. Null when the row carries neither a parseable
 * entry timestamp nor a message one, which is a row we cannot place in time and
 * therefore do not emit.
 */
function rowTimeMs(row: PiRow): number | null {
  if (row.timestamp !== null) {
    const parsed = Date.parse(row.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return row.message?.timestampMs ?? null;
}

/** The facts a user turn carries: how much was typed, never what. */
function userPromptAttributes(row: PiRow): Record<string, PiAttributeValue> {
  return { prompt_length: contentText(row.message?.content).length };
}

/** The token buckets pi reported, under the names the shared fold reads. */
function tokenAttributes(tokens: PiTokens): Record<string, PiAttributeValue> {
  const attributes: Record<string, PiAttributeValue> = {};
  if (tokens.input !== null) attributes.input_tokens = tokens.input;
  if (tokens.output !== null) attributes.output_tokens = tokens.output;
  if (tokens.cacheRead !== null) attributes.cache_read_tokens = tokens.cacheRead;
  if (tokens.cacheWrite !== null) {
    attributes.cache_creation_tokens = tokens.cacheWrite;
  }
  return attributes;
}

/**
 * The facts an assistant turn carries.
 *
 * `cost_usd` is present only when pi reported one. The branch is on
 * `cost.reported` rather than on the number, because the absent variant has no
 * number to test — which is the whole point of it.
 */
function assistantAttributes(row: PiRow): Record<string, PiAttributeValue> {
  const message = row.message;
  const attributes: Record<string, PiAttributeValue> = {};
  if (message?.model) attributes.model = message.model;
  // The provider pi dialled, recorded as a property of a pi turn. Never in the
  // scope, the service name or the event name, which is where identity is read.
  if (message?.provider) attributes["gen_ai.provider.name"] = message.provider;
  if (message?.stopReason) attributes.stop_reason = message.stopReason;
  if (row.cost.reported) attributes.cost_usd = row.cost.total;
  return { ...attributes, ...tokenAttributes(row.tokens) };
}

/**
 * The facts a tool result carries.
 *
 * No `duration_ms`: pi records when a tool result was written, not how long the
 * tool ran, and a fabricated duration would read as a measurement. The session
 * fold treats a missing one as zero, which is the honest answer.
 */
function toolResultAttributes(row: PiRow): Record<string, PiAttributeValue> {
  const message = row.message;
  const attributes: Record<string, PiAttributeValue> = {
    // Bytes, not characters: this is the size fed back into the context window.
    tool_result_size_bytes: Buffer.byteLength(
      contentText(message?.content),
      "utf8",
    ),
  };
  if (message?.toolName) attributes.tool_name = message.toolName;
  if (message?.isError !== null && message?.isError !== undefined) {
    attributes.success = !message.isError;
  }
  return attributes;
}

/** One event, before it is given a session, an agent and a time. */
interface MappedEvent {
  readonly name: string;
  readonly attributes: Record<string, PiAttributeValue>;
}

/**
 * The `api_request` that carries what a row was billed, when the row is not an
 * assistant turn. Null when there is nothing billed to carry.
 *
 * pi bills three kinds of row, and its own totals add all three: the assistant
 * turn, a tool that did nested LLM work (`session-format.md:99`), and the
 * summary written for a compaction or a branch (`:244`, `:259` — "included in
 * session token and cost totals"). Neither of the last two was present in the
 * five sessions on this machine (0 of 69 tool results carried usage, and none
 * of the 156 rows was a compaction), so this is built to pi's documented format
 * rather than to a measured example — stated because the difference matters if
 * the format is wrong.
 *
 * The reason they get their own event rather than a `cost_usd` on the row's own
 * record: the session fold reads a cost off exactly ONE event name,
 * `api_request` (`coding-agent-session.derivation.ts:984`). A `cost_usd` on a
 * `tool_result` is money the fold never looks at — right in this file's tests
 * and zero in the product. They also fold as model calls, which is what they
 * are: something dialled a model and pi paid for it.
 */
function billedWorkEvent(row: PiRow): MappedEvent | null {
  // An assistant turn's cost already rides the api_request it becomes.
  if (row.message?.role === "assistant") return null;
  if (!row.cost.reported) return null;
  return {
    name: PI_EVENT.API_REQUEST,
    attributes: {
      cost_usd: row.cost.total,
      ...tokenAttributes(row.tokens),
    },
  };
}

/** The event one row becomes, or null for a row that is not conversation. */
function conversationEventForRow(row: PiRow): MappedEvent | null {
  if (row.type !== "message" || row.message === null) return null;
  switch (row.message.role) {
    case "user":
      return {
        name: PI_EVENT.USER_PROMPT,
        attributes: userPromptAttributes(row),
      };
    case "assistant":
      // Including a turn that ended in an error: the reply failed, but pi still
      // billed it, and `api_request` is the only event the session fold reads a
      // cost off. A separate `api_error` would count the failure and drop the
      // money.
      return {
        name: PI_EVENT.API_REQUEST,
        attributes: assistantAttributes(row),
      };
    case "toolResult":
      return {
        name: PI_EVENT.TOOL_RESULT,
        attributes: toolResultAttributes(row),
      };
    default:
      // `bashExecution`, `custom`, and whatever a later pi adds. Nothing in the
      // shared vocabulary answers to them, and inventing a mapping would be
      // guessing at facts we do not have.
      return null;
  }
}

/**
 * Every event one row becomes, in the order they happened.
 *
 * The billed work leads: the tool ran its nested model call before it wrote the
 * result, and the summariser ran before pi appended the compaction entry. Both
 * events take the row's one timestamp, so this ordering is the only thing that
 * says which came first.
 */
function eventsForRow(row: PiRow): MappedEvent[] {
  const events: MappedEvent[] = [];
  const billed = billedWorkEvent(row);
  if (billed !== null) events.push(billed);
  const conversation = conversationEventForRow(row);
  if (conversation !== null) events.push(conversation);
  return events;
}

/**
 * The lineage attributes, in the spelling the session fold reads.
 *
 * On EVERY event, alongside `session.id`, rather than on one event of its own.
 * Two reasons, both verified by running the server fold:
 *
 *   - The fold takes lineage through `withIdentity`, which it only reaches for
 *     a record whose event name normalizes to one it knows
 *     (`coding-agent-session.derivation.ts:955`). A dedicated `pi.session_start`
 *     would be dropped whole — attributes and all — with nothing to show for it.
 *   - `parentSessionId` is ONCE-SET (`:562`): the first record to carry it wins
 *     for the life of the session. Putting it on all of them means whichever
 *     record arrives first is right, instead of the answer depending on which
 *     export batch landed first.
 *
 * Absent rather than false: a session with no parent stamps neither key, so the
 * fold keeps its own null/false defaults and a blank column keeps meaning "not
 * reported" rather than "reported as none". A parent whose file could not be
 * read stamps `is_fork` alone — it is still a branch, we just could not name
 * what it branched from.
 */
function lineageAttributesFor(
  lineage: PiLineage | undefined,
): Record<string, PiAttributeValue> {
  if (lineage === undefined) return {};
  const attributes: Record<string, PiAttributeValue> = {};
  if (lineage.parentSessionId !== null) {
    attributes.parent_session_id = lineage.parentSessionId;
  }
  if (lineage.isFork) attributes.is_fork = true;
  return attributes;
}

/**
 * Every event one pi session yields, in the order pi wrote the rows.
 *
 * Order is the file's, unmodified: the reader hands rows back in file order and
 * this maps over them, so nothing sorts, groups or re-times them. That matters
 * because both of pi's clocks are monotonic in file order but disagree by up to
 * two minutes with each other, so a re-sort on either clock would be a
 * different conversation.
 *
 * Empty when the session has no header id: every record is keyed by
 * `session.id`, and a batch of events belonging to no session is worse than
 * none — the pipeline would mint a session per record.
 *
 * `lineage` is optional because resolving it means opening the parent's file,
 * which is I/O this function does not do — `pi-session-lineage.ts` resolves it
 * once per session and the caller passes the answer in. Omitting it stamps no
 * lineage at all, which is the honest reading: nothing was looked up.
 */
export function buildPiTurnEvents({
  session,
  lineage,
}: {
  session: PiSession;
  lineage?: PiLineage;
}): PiTurnEvent[] {
  const sessionId = session.header?.sessionId;
  if (!sessionId) return [];
  const lineageAttributes = lineageAttributesFor(lineage);
  const events: PiTurnEvent[] = [];
  for (const row of session.rows) {
    const mapped = eventsForRow(row);
    if (mapped.length === 0) continue;
    const timeUnixMs = rowTimeMs(row);
    if (timeUnixMs === null) continue;
    for (const event of mapped) {
      events.push({
        name: event.name,
        timeUnixMs,
        attributes: {
          "event.name": event.name,
          "session.id": sessionId,
          "coding_agent.name": PI_AGENT_ID,
          ...lineageAttributes,
          ...event.attributes,
        },
      });
    }
  }
  return events;
}

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

/**
 * One OTLP/HTTP JSON logs request.
 *
 * Declared here rather than reused from `session-context.ts`: that payload
 * carries string attributes only, and widening its value type would put a
 * discriminant in front of every existing reader of a record that has none.
 * The shape is a wire format, not logic — the logic that posts it is the shared
 * `postOtlpBody`.
 */
export interface PiOtlpLogsPayload {
  resourceLogs: Array<{
    resource: { attributes: OtlpKeyValue[] };
    scopeLogs: Array<{
      scope: { name: string; version: string };
      logRecords: Array<{
        timeUnixNano: string;
        severityNumber: number;
        severityText: string;
        eventName: string;
        attributes: OtlpKeyValue[];
      }>;
    }>;
  }>;
}

function encodeValue(key: string, value: PiAttributeValue): OtlpAnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Number.isInteger(value) && !DOUBLE_VALUED_ATTRIBUTES.has(key)) {
    // OTLP/JSON spells a 64-bit integer as a string, per protojson.
    return { intValue: String(value) };
  }
  return { doubleValue: value };
}

function encodeAttributes(
  attributes: Readonly<Record<string, PiAttributeValue>>,
): OtlpKeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: encodeValue(key, value),
  }));
}

/**
 * The OTLP body for a batch of pi events.
 *
 * `resourceLogs` and nothing else: pi's records are events, and a
 * `resourceSpans` alongside them would double-count every turn, because the
 * session fold reads model calls and tool runs from the events of a logs-only
 * agent AND from the spans of every other one.
 */
export function buildPiEventsPayload({
  events,
  scopeVersion,
}: {
  events: readonly PiTurnEvent[];
  scopeVersion: string;
}): PiOtlpLogsPayload {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: PI_SERVICE_NAME } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: PI_EVENT_SCOPE, version: scopeVersion },
            logRecords: events.map((event) => ({
              timeUnixNano: `${event.timeUnixMs}000000`,
              severityNumber: SEVERITY_INFO,
              severityText: "INFO",
              eventName: event.name,
              attributes: encodeAttributes(event.attributes),
            })),
          },
        ],
      },
    ],
  };
}
