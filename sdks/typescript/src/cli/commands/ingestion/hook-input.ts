/**
 * The payload a coding agent hands `langwatch ingest hook <tool>`: how it
 * arrives, and what it is allowed to say.
 *
 * All three seams write the same JSON object to the hook's stdin, so reading it
 * is one concern with two halves: draining the pipe without ever waiting
 * forever on it, and reading a few optional strings out of whatever turned up.
 * Every malformed shape reads as an empty payload, which is what lets the
 * command stay silent instead of explaining itself to a session.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import type { Readable } from "node:stream";

import { z } from "zod";

/** How long stdin has to deliver the payload before we act on what arrived. */
const STDIN_TIMEOUT_MS = 2_000;

/**
 * The most stdin may hand over. A hook payload is three short strings, so
 * anything past this is not one, and buffering it would be work done on behalf
 * of whatever is writing rather than on behalf of the session.
 */
const STDIN_MAX_BYTES = 64 * 1024;

/**
 * A field the payload may omit, may send as something other than a string, or
 * may leave blank. All three read the same way, absent, so nothing downstream
 * has to tell them apart.
 */
const reportedText = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0)
  .optional()
  .catch(undefined);

/**
 * The payload as a seam writes it. Untrusted end to end: it arrives on a pipe
 * any process on the machine may be holding, so every field is validated
 * rather than asserted, and the schema is the only description of the shape.
 */
const hookInputSchema = z
  .object({
    session_id: reportedText,
    cwd: reportedText,
    hook_event_name: reportedText,
    // Claude's SessionStart payload carries the session's current title when
    // one is set (`--name` at launch, `/rename` before a resume). Absent on
    // the other events, where the live registry answers instead.
    session_title: reportedText,
  })
  .transform(
    (
      payload,
    ): {
      sessionId?: string;
      cwd?: string;
      hookEventName?: string;
      sessionTitle?: string;
    } => ({
      sessionId: payload.session_id,
      cwd: payload.cwd,
      hookEventName: payload.hook_event_name,
      sessionTitle: payload.session_title,
    }),
  );

/** The facts a seam reports, each absent until proven otherwise. */
export type HookInput = z.infer<typeof hookInputSchema>;

/**
 * Drain stdin. A terminal is not a hook payload, so it reads as empty.
 *
 * Bounded in both directions, by the deadline and by the byte cap, because a
 * seam that spawns the hook with a pipe it never closes would otherwise leave
 * it draining for the rest of the session, and the opencode plugin spawns it
 * without waiting, so nothing upstream would notice. Whatever arrived by the
 * deadline is what gets parsed, and half a payload is not JSON, so it takes the
 * same silent path as none. A payload past the cap takes that path too: the
 * read stops there rather than buffering the rest of whatever is being written.
 */
export async function readStdin({
  stream = process.stdin,
  timeoutMs = STDIN_TIMEOUT_MS,
}: {
  stream?: Readable & { isTTY?: boolean };
  timeoutMs?: number;
} = {}): Promise<string> {
  if (stream.isTTY) return "";

  const chunks: Buffer[] = [];
  let received = 0;
  let overflowed = false;
  const drained = (async () => {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      received += buffer.byteLength;
      if (received > STDIN_MAX_BYTES) {
        overflowed = true;
        stream.destroy();
        return;
      }
      chunks.push(buffer);
    }
  })().catch(() => {
    // Torn down at the deadline, or a stream that failed mid-read. Either way
    // what already arrived is all there is to work with.
  });

  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    drained,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        // Destroying releases the handle as well as the wait: a pipe still
        // being read keeps the process alive after the hook is done with it.
        stream.destroy();
        resolve();
      }, timeoutMs);
      // The deadline must never be the reason the process stays up.
      timer.unref();
    }),
  ]);
  clearTimeout(timer);

  // Too big to be a hook payload, so it is not read as one at all: a prefix of
  // an oversized write is exactly the kind of half-payload the command is
  // meant to stay quiet about.
  if (overflowed) return "";

  return Buffer.concat(chunks).toString("utf8");
}

/** Read the payload out of `raw`. Anything that is not a JSON object is empty. */
export function parseHookInput(raw: string): HookInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Empty stdin, or something that is not JSON. Neither is worth a word.
    return {};
  }

  const result = hookInputSchema.safeParse(parsed);
  return result.success ? result.data : {};
}
