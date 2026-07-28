/**
 * Resolving the RESULT DIGEST for a tool call, wherever the call came from.
 *
 * The digest — which resource/verb ran, the parsed flags, the ids it surfaced,
 * honest counts — is what a capability card hydrates fresh data from. The
 * server's CLI envelope computes it once and records it on the durable tool
 * part, but the panel also renders calls that never carried one:
 *
 *   - LIVE end frames: the AI-SDK tool chunk has no metadata slot (useChat
 *     rebuilds the part from the START invocation), so the digest cannot ride
 *     the chunk. The relay has already reduced the output to its JSON document,
 *     and the extractor is shared code — recomputing here yields the SAME
 *     digest the server recorded, deterministically.
 *   - OLD turns: recorded before digests existed. Computed best-effort from
 *     the stored output; unreadable output stays the text tier, exactly the
 *     honesty the fallback path already has.
 *
 * A recorded digest is VALIDATED (zod), never trusted — a part is stored data,
 * and stored data drifts.
 */
import {
  cliResultDigestSchema,
  extractDigest,
  type CliResultDigest,
} from "@langwatch/langy";
import { parseLangwatchCommand } from "~/server/app-layer/langy/execution/langwatchCommand";

/** The typed tool name the CLI envelope records calls under. */
const CLI_TOOL_NAME = /^langwatch\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/;

/** Keys a shell tool may pass its command under (mirrors the server envelope). */
const COMMAND_KEYS = ["command", "cmd", "script"];

function readCommandString(input: unknown): string | null {
  if (typeof input === "string") return input.trim() ? input : null;
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of COMMAND_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** A CLI call's identity plus the flags it ran with. */
export interface CapabilityCommand {
  resource: string;
  verb: string;
  query: Record<string, unknown>;
}

/**
 * The `langwatch <resource> <verb>` behind a tool call, with its parsed flags —
 * or null when the call was not a CLI invocation. Works from the START frame
 * (before any output exists), which is what lets a card begin hydrating while
 * the agent is still working.
 *
 * The command string in the input is the primary source (it carries the flags);
 * the typed tool name plus a structured input is the fixtures/legacy shape.
 */
export function commandOfToolCall({
  name,
  input,
}: {
  name: string;
  input: unknown;
}): CapabilityCommand | null {
  const command = readCommandString(input);
  if (command) {
    const parsed = parseLangwatchCommand(command);
    if (parsed) {
      return { resource: parsed.resource, verb: parsed.verb, query: parsed.args };
    }
  }

  const typed = CLI_TOOL_NAME.exec(name);
  if (!typed) return null;
  const structured =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return { resource: typed[1]!, verb: typed[2]!, query: structured };
}

/**
 * The digest for one settled tool call: the recorded one when the part carries
 * it (validated, never trusted), else computed from the call itself via the
 * shared extractor. Null when the call was not a LangWatch CLI invocation at
 * all — those have no reference to hydrate from.
 */
export function digestOfToolCall({
  name,
  input,
  output,
  digest,
}: {
  name: string;
  input: unknown;
  output: unknown;
  digest?: unknown;
}): CliResultDigest | null {
  const recorded = cliResultDigestSchema.safeParse(digest);
  if (recorded.success) return recorded.data;

  const command = commandOfToolCall({ name, input });
  if (!command) return null;

  return extractDigest({
    resource: command.resource,
    verb: command.verb,
    args: command.query,
    output,
  });
}
