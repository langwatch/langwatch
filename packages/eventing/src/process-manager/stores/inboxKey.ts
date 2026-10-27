import { createHash } from "node:crypto";

/** Derive inbox unique key from source event id; hash to keep index width bounded. */
export function deriveInboxKey(sourceEventId: string): string {
  return createHash("sha256").update(sourceEventId, "utf8").digest("hex");
}
