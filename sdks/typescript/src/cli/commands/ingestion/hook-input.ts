/**
 * The payload a coding agent hands `langwatch ingest hook <tool>`: how it
 * arrives, and what it is allowed to say.
 *
 * All three seams write the same JSON object to the hook's stdin, so reading it
 * is one concern with two halves: draining the pipe without ever waiting
 * forever on it, and reading three optional strings out of whatever turned up.
 * Every malformed shape reads as an empty payload, which is what lets the
 * command stay silent instead of explaining itself to a session.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import type { Readable } from "node:stream";

/** How long stdin has to deliver the payload before we act on what arrived. */
const STDIN_TIMEOUT_MS = 2_000;

/** The three facts every seam reports, each absent until proven otherwise. */
export interface HookInput {
  sessionId?: string;
  cwd?: string;
  hookEventName?: string;
}

/**
 * Drain stdin. A terminal is not a hook payload, so it reads as empty.
 *
 * Bounded like every other wait the command makes. A seam that spawns the hook
 * with a pipe it never closes would otherwise leave it draining for the rest of
 * the session, and the opencode plugin spawns it without waiting, so nothing
 * upstream would notice. Whatever arrived by the deadline is what gets parsed,
 * and half a payload is not JSON, so it takes the same silent path as none.
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
  const drained = (async () => {
    for await (const chunk of stream) chunks.push(chunk as Buffer);
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

  return Buffer.concat(chunks).toString("utf8");
}

/** Read the payload out of `raw`. Anything that is not a JSON object is empty. */
export function parseHookInput(raw: string): HookInput {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      sessionId: stringField(record.session_id),
      cwd: stringField(record.cwd),
      hookEventName: stringField(record.hook_event_name),
    };
  } catch {
    // Empty stdin, or something that is not JSON. Neither is worth a word.
    return {};
  }
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
