/**
 * The langy-worker wire protocol, both directions. See PROTOCOL.md for the
 * contract prose; this module is its typed form plus the bounding helpers.
 */

export const PROTOCOL_VERSION = 1;

/** Per-field cap. The canonical 8KB reduction happens on the Go side. */
export const MAX_FIELD_BYTES = 1024 * 1024;
export const TRUNCATION_MARKER = "\n[truncated by langy-worker]";

// ---- manager -> wrapper -------------------------------------------------

export type TurnCommand = {
  type: "turn";
  turnId: string;
  prompt: string;
  system?: string;
  resumeToken?: string;
};

export type AbortCommand = { type: "abort"; turnId: string };
export type ShutdownImminentCommand = { type: "shutdown_imminent"; deadlineMs: number };
export type PingCommand = { type: "ping" };

export type ManagerCommand = TurnCommand | AbortCommand | ShutdownImminentCommand | PingCommand;

/**
 * Parse one stdin line into a command. Returns undefined for unparseable or
 * unknown lines (the caller warns on stderr and moves on; a bad line must
 * never take the worker down).
 */
export function parseCommand(line: string): ManagerCommand | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const cmd = value as Record<string, unknown>;
  switch (cmd.type) {
    case "turn":
      if (typeof cmd.turnId !== "string" || cmd.turnId === "" || typeof cmd.prompt !== "string") {
        return undefined;
      }
      return {
        type: "turn",
        turnId: cmd.turnId,
        prompt: cmd.prompt,
        ...(typeof cmd.system === "string" ? { system: cmd.system } : {}),
        ...(typeof cmd.resumeToken === "string" ? { resumeToken: cmd.resumeToken } : {}),
      };
    case "abort":
      if (typeof cmd.turnId !== "string") return undefined;
      return { type: "abort", turnId: cmd.turnId };
    case "shutdown_imminent":
      return {
        type: "shutdown_imminent",
        deadlineMs: typeof cmd.deadlineMs === "number" ? cmd.deadlineMs : 0,
      };
    case "ping":
      return { type: "ping" };
    default:
      return undefined;
  }
}

// ---- wrapper -> manager -------------------------------------------------

/**
 * `resumed` reports whether the worker continued a persisted session its home
 * already held (see session.ts). The manager reads it to skip the transcript
 * seed for a resumed conversation; an absent field reads as false, so an
 * older worker binary keeps the seed path.
 */
export type ReadyEvent = { type: "ready"; protocol: number; resumed: boolean };
export type PongEvent = { type: "pong" };
export type TurnStartedEvent = { type: "turn_started"; turnId: string };
export type DeltaEvent = { type: "delta"; turnId: string; text: string };
export type ReasoningEvent = { type: "reasoning"; turnId: string; text: string };
export type ToolStartEvent = {
  type: "tool_start";
  turnId: string;
  id: string;
  name: string;
  input: unknown;
};
export type ToolUpdateEvent = {
  type: "tool_update";
  turnId: string;
  id: string;
  name: string;
  output?: string;
};
export type ToolEndEvent = {
  type: "tool_end";
  turnId: string;
  id: string;
  name: string;
  input: unknown;
  isError: boolean;
  output: string;
};
export type PlanItem = { content: string; status: string };
export type PlanEvent = { type: "plan"; turnId: string; items: PlanItem[] };
export type TurnDoneEvent = {
  type: "turn_done";
  turnId: string;
  outcome: "ok" | "error" | "aborted";
  errorMessage?: string;
};
export type HandoffEvent = { type: "handoff"; turnId: string; seed: string };

export type WorkerEvent =
  | ReadyEvent
  | PongEvent
  | TurnStartedEvent
  | DeltaEvent
  | ReasoningEvent
  | ToolStartEvent
  | ToolUpdateEvent
  | ToolEndEvent
  | PlanEvent
  | TurnDoneEvent
  | HandoffEvent;

export type TerminalEvent = TurnDoneEvent | HandoffEvent;

// ---- bounding -----------------------------------------------------------

/** Cap a string field at MAX_FIELD_BYTES, appending the truncation marker. */
export function boundText({
  text,
  maxBytes = MAX_FIELD_BYTES,
}: {
  text: string;
  maxBytes?: number;
}): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const budget = maxBytes - Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  // Below the marker's own size there is no room to say "truncated": the cap wins.
  if (budget <= 0) return truncateToBytes({ text, maxBytes });
  return truncateToBytes({ text, maxBytes: budget }) + TRUNCATION_MARKER;
}

/**
 * Cap a JSON value (tool input). Values whose serialized form fits pass
 * through untouched; oversized values are replaced by a truncated JSON string
 * carrying the marker, so the field stays valid JSON either way.
 */
export function boundJsonValue({
  value,
  maxBytes = MAX_FIELD_BYTES,
}: {
  value: unknown;
  maxBytes?: number;
}): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    // The fallback prose is still subject to maxBytes: a cyclic value must not
    // be the one input that walks past the cap the caller asked for.
    return boundText({
      text: `[unserializable value]${TRUNCATION_MARKER}`,
      maxBytes,
    });
  }
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) return value;
  const budget = maxBytes - Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  if (budget <= 0) return truncateToBytes({ text: serialized, maxBytes });
  return truncateToBytes({ text: serialized, maxBytes: budget }) + TRUNCATION_MARKER;
}

/** Byte-accurate truncation that never splits a code point. */
export function truncateToBytes({
  text,
  maxBytes,
}: {
  text: string;
  maxBytes: number;
}): string {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return text;
  let end = maxBytes;
  // Back off continuation bytes (0b10xxxxxx) so the cut lands on a boundary.
  while (end > 0) {
    const byte = buffer[end];
    if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) break;
    end--;
  }
  return buffer.subarray(0, end).toString("utf8");
}
