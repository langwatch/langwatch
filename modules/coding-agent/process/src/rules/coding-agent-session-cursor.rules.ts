import type { CodingAgentSessionCursor } from "@langwatch/coding-agent-contract";
import { z } from "zod";

/** The keyset cursor's wire form: the event time and record id, base64url JSON. */
const wireCursorSchema = z.object({ t: z.number(), r: z.string() });

export function encodeSessionCursor(cursor: CodingAgentSessionCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.timeUnixMs, r: cursor.recordId })).toString(
    "base64url",
  );
}

/** The cursor a caller sent back, or the word that this door never wrote it. */
export function readSessionCursor(
  raw: string,
): { decodable: true; cursor: CodingAgentSessionCursor } | { decodable: false } {
  const parsed = wireCursorSchema.safeParse(jsonOf(Buffer.from(raw, "base64url").toString("utf8")));
  if (!parsed.success) return { decodable: false };
  return { decodable: true, cursor: { timeUnixMs: parsed.data.t, recordId: parsed.data.r } };
}

/** JSON text as a value, or nothing for text that is not JSON. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
