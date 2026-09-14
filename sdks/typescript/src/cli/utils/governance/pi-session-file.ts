/**
 * Reading one pi session file into structured rows.
 *
 * pi writes a session as JSONL: a first line of type `session` carrying the
 * session id, the format version and the working directory, then one line per
 * event. Rows link to each other by `id`/`parentId`, forming the fork tree
 * (`docs/session-format.md`). Only assistant replies carry a model, a provider
 * and a cost; user and tool-result rows carry none of them.
 *
 * This module parses. It does not fetch, emit, tail or de-duplicate — rungs 9
 * through 11 of `dev/docs/adr/132-implementation-ladder.md` own those, and each
 * of them wants the same rows.
 *
 * Three properties of the file drive the shape of what comes back.
 *
 * **The tail can be torn.** pi appends as it goes, so a file read while pi is
 * still running, or one a SIGKILL cut short, can end in half a line. That is an
 * ordinary state, not corruption: the bytes before it are intact and complete.
 * We drop the unparseable line, keep everything before it, and say so on
 * {@link PiSession.tornTail} rather than raising — a capture path is not worth
 * an exit code, and the alternative is losing a whole session to its last
 * fifty bytes.
 *
 * **An absent number is not zero.** Only an explicit `cost.total` of `0` is
 * zero. A turn whose cost pi never wrote — because it errored before billing,
 * or because a future pi renamed the field — is absent. ADR-132 §9 makes this
 * the distinction the reader must not collapse: a fabricated `$0.00` renders
 * identically to a genuinely cheap turn, so a total capture failure would be
 * invisible. {@link PiCost} is a discriminated union for exactly that reason —
 * `total` does not exist on the absent branch, so `cost.total ?? 0` will not
 * compile and no one can flatten the two by accident.
 *
 * **The version may be one this build has never seen.** See
 * {@link KNOWN_SESSION_VERSIONS}.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { readFile } from "node:fs/promises";

/**
 * The format versions this build was written against (`session-format.md`):
 * 1 is a linear entry sequence, 2 added the `id`/`parentId` tree, 3 renamed the
 * `hookMessage` role to `custom`. pi migrates older files to the current
 * version when it loads them, so a 1 or a 2 on disk is a file pi has not opened
 * yet.
 */
export const KNOWN_SESSION_VERSIONS: readonly number[] = [1, 2, 3];

/**
 * A cost pi reported, or the fact that it reported none.
 *
 * Deliberately a discriminated union rather than `number | null`: `null` is one
 * `??` away from becoming a zero, and this is the one number in the capture
 * that a reader will interpret as money. The absent branch carries no `total`
 * at all, so reaching for one is a type error at the call site instead of a
 * fabricated `$0.00` on a customer's screen.
 */
export type PiCost =
  | { readonly reported: true; readonly total: number }
  | { readonly reported: false };

/** The absent cost. One shared value; the type has no other inhabitant. */
export const NO_COST: PiCost = { reported: false };

/**
 * Tokens pi reported for a row, each field `null` where pi wrote nothing.
 *
 * Weaker than {@link PiCost} on purpose. Token counts are not money: a wrong
 * zero in a token column is a wrong number, while a wrong zero in a cost column
 * is a capture failure wearing the costume of a cheap session. Only the latter
 * is worth making unrepresentable.
 */
export interface PiTokens {
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
  readonly total: number | null;
}

/** No tokens reported at all. */
export const NO_TOKENS: PiTokens = {
  input: null,
  output: null,
  cacheRead: null,
  cacheWrite: null,
  total: null,
};

/**
 * The first line of the file. Metadata only: it is not an entry, carries no row
 * id, and takes no part in the `id`/`parentId` tree.
 */
export interface PiSessionHeader {
  /** The session UUID. The identity one pi session is recorded under. */
  readonly sessionId: string | null;
  /** The format version, or null when the header carries none (a v1 file). */
  readonly version: number | null;
  /** The directory pi ran in. */
  readonly cwd: string | null;
  /** ISO timestamp of session creation. */
  readonly timestamp: string | null;
  /**
   * Path to the session this one was split off, present only for `/fork`,
   * `/clone` and `newSession({ parentSession })`. A **file path**, not a session
   * id — ADR-132 §8 resolves it to an id by opening that file, and never stores
   * the path.
   */
  readonly parentSessionFile: string | null;
}

/** The message an entry of type `message` carries. */
export interface PiMessage {
  /** `user`, `assistant`, `toolResult`, `bashExecution`, `custom`, … */
  readonly role: string;
  /**
   * `string` or an array of content blocks (`text`, `thinking`, `toolCall`,
   * `image`), exactly as pi wrote it. Left as `unknown` because interpreting
   * blocks into a transcript is rung 9's decision, and guessing at it here
   * would fix that shape before anything reads it.
   */
  readonly content: unknown;
  /** Assistant rows only. */
  readonly model: string | null;
  /** Assistant rows only. The provider pi dialled — never what we record as the agent (ADR-132 §4). */
  readonly provider: string | null;
  /** Assistant rows only. */
  readonly api: string | null;
  /** Assistant rows only: `stop`, `length`, `toolUse`, `error`, `aborted`. */
  readonly stopReason: string | null;
  /** Assistant rows only, and only when the turn failed. */
  readonly errorMessage: string | null;
  /** Tool-result rows only. */
  readonly toolName: string | null;
  /** Tool-result rows only. */
  readonly toolCallId: string | null;
  /** Tool-result rows only. */
  readonly isError: boolean | null;
  /** Unix milliseconds. The message clock, distinct from the entry's ISO timestamp. */
  readonly timestampMs: number | null;
}

/** One parsed entry. Every line of the file except the header becomes one. */
export interface PiRow {
  /** `message`, `model_change`, `compaction`, `branch_summary`, `label`, … */
  readonly type: string;
  /** The 8-char row id. Unique within a file, **not** across files (ADR-132 §8). */
  readonly id: string | null;
  /** The parent row's id. Null on the first entry, and on a row pi wrote without one. */
  readonly parentId: string | null;
  /** ISO timestamp on the entry. */
  readonly timestamp: string | null;
  /** Present for `type: "message"`, null for every other entry kind. */
  readonly message: PiMessage | null;
  /**
   * What this row cost, from wherever pi put the usage: on the message for
   * assistant and tool-result rows, on the entry itself for `compaction` and
   * `branch_summary`. One place for rung 10 to sum, so no cost-bearing row
   * shape can be forgotten at the call site.
   */
  readonly cost: PiCost;
  /** Tokens for this row, from the same `usage` object as {@link PiRow.cost}. */
  readonly tokens: PiTokens;
}

/** Everything one session file says. */
export interface PiSession {
  /** Null when the file's first line is not a `session` entry. */
  readonly header: PiSessionHeader | null;
  /** Every entry after the header, in file order. Empty for an abandoned session. */
  readonly rows: readonly PiRow[];
  /** Lines dropped because they did not parse. Normally 0, or 1 for a torn tail. */
  readonly skippedLines: number;
  /**
   * The final non-empty line did not parse — pi was mid-append, or the process
   * died mid-write. Rung 11's tailing loop uses this to avoid advancing its
   * offset past bytes that are not yet a complete row.
   */
  readonly tornTail: boolean;
  /**
   * The header's version is one of {@link KNOWN_SESSION_VERSIONS}. False for a
   * version this build predates, and for a header that carries none.
   */
  readonly versionIsKnown: boolean;
}

/** An empty session: no header, no rows, nothing wrong. */
const EMPTY_SESSION: PiSession = {
  header: null,
  rows: [],
  skippedLines: 0,
  tornTail: false,
  versionIsKnown: false,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A number pi actually wrote. NaN and Infinity are not numbers pi wrote. */
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The cost inside a `usage` object.
 *
 * Reported only when `cost.total` is a real number. A `usage` with no `cost`, a
 * `cost` with no `total`, and a `total` that is null or a string are all the
 * same thing: pi did not report a cost. None of them becomes zero.
 */
function readCost(usage: Record<string, unknown> | null): PiCost {
  if (!usage) return NO_COST;
  const cost = asRecord(usage.cost);
  if (!cost) return NO_COST;
  const total = asNumber(cost.total);
  return total === null ? NO_COST : { reported: true, total };
}

function readTokens(usage: Record<string, unknown> | null): PiTokens {
  if (!usage) return NO_TOKENS;
  return {
    input: asNumber(usage.input),
    output: asNumber(usage.output),
    cacheRead: asNumber(usage.cacheRead),
    cacheWrite: asNumber(usage.cacheWrite),
    total: asNumber(usage.totalTokens),
  };
}

function readHeader(entry: Record<string, unknown>): PiSessionHeader {
  return {
    sessionId: asString(entry.id),
    version: asNumber(entry.version),
    cwd: asString(entry.cwd),
    timestamp: asString(entry.timestamp),
    parentSessionFile: asString(entry.parentSession),
  };
}

function readMessage(value: unknown): PiMessage | null {
  const message = asRecord(value);
  if (!message) return null;
  const role = asString(message.role);
  if (role === null) return null;
  return {
    role,
    content: message.content,
    model: asString(message.model),
    provider: asString(message.provider),
    api: asString(message.api),
    stopReason: asString(message.stopReason),
    errorMessage: asString(message.errorMessage),
    toolName: asString(message.toolName),
    toolCallId: asString(message.toolCallId),
    isError: typeof message.isError === "boolean" ? message.isError : null,
    timestampMs: asNumber(message.timestamp),
  };
}

function readRow(entry: Record<string, unknown>, type: string): PiRow {
  const messageValue = asRecord(entry.message);
  const message = readMessage(messageValue);
  // Usage sits on the message for assistant and tool-result rows, and on the
  // entry itself for `compaction` and `branch_summary`. Prefer the message so a
  // row carrying both is read the way pi's own totals read it.
  const usage = asRecord(messageValue?.usage) ?? asRecord(entry.usage);
  return {
    type,
    id: asString(entry.id),
    parentId: asString(entry.parentId),
    timestamp: asString(entry.timestamp),
    message,
    cost: readCost(usage),
    tokens: readTokens(usage),
  };
}

/**
 * Parse the contents of one pi session file.
 *
 * Never throws. A line that does not parse is dropped and counted; an entry
 * kind this build does not know is kept as a row with its `type` intact, so a
 * pi that adds an entry kind loses nothing but the fields we never read.
 */
export function parsePiSessionFile(content: string): PiSession {
  const lines = content.split("\n");
  let header: PiSessionHeader | null = null;
  let sawHeader = false;
  const rows: PiRow[] = [];
  let skippedLines = 0;
  let tornTail = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      skippedLines++;
      // Overwritten by any later line that does parse, so this ends up true
      // only when the torn line really is the last one in the file.
      tornTail = true;
      continue;
    }
    tornTail = false;

    const entry = asRecord(parsed);
    const type = entry === null ? null : asString(entry.type);
    if (entry === null || type === null) {
      // Valid JSON, but not an entry: a bare array, a number, a `{}`. Nothing
      // downstream can do with it.
      skippedLines++;
      continue;
    }

    if (type === "session") {
      // The header is metadata, not an entry. A second one would be pi writing
      // a file we do not understand; the first wins and the rest are ignored
      // rather than silently replacing the session's identity mid-file.
      if (!sawHeader) {
        header = readHeader(entry);
        sawHeader = true;
      }
      continue;
    }

    rows.push(readRow(entry, type));
  }

  const version = header?.version ?? null;
  return {
    header,
    rows,
    skippedLines,
    tornTail,
    versionIsKnown: version !== null && KNOWN_SESSION_VERSIONS.includes(version),
  };
}

/**
 * Read and parse a session file, or return null when there is nothing to read.
 *
 * Null covers both "pi has not written this session yet" and "we could not read
 * it". pi defers the first write until the first assistant reply (ADR-132 §2),
 * so a session the user abandoned before then leaves no file at all — the
 * common case, and an ordinary one. A permission error is rarer and equally not
 * worth failing the user's coding session over, so it takes the same exit.
 *
 * Null and {@link EMPTY_SESSION} say different things and both are silent: null
 * is "no file", an empty `rows` is "a file with nothing in it yet".
 */
export async function readPiSessionFile(
  path: string,
): Promise<PiSession | null> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return null;
  }
  if (content.trim() === "") return EMPTY_SESSION;
  return parsePiSessionFile(content);
}
