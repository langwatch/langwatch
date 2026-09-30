import { z } from "zod";
import type { TriggerFireCursor } from "./repositories/trigger-fire-history.repository";

const wireCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().min(1),
});

/** The opaque page cursor the REST surface hands out: base64url JSON of the
 *  `(createdAt, id)` pair the keyset walk resumes after. */
export function encodeTriggerFireCursor(cursor: TriggerFireCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

/** The cursor a caller sent back, or null when it is not one we issued. */
export function decodeTriggerFireCursor(
  encoded: string,
): TriggerFireCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = wireCursorSchema.safeParse(parsed);
  if (!result.success) return null;
  return { createdAt: new Date(result.data.createdAt), id: result.data.id };
}
