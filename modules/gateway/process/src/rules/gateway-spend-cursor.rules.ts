export type GatewaySpendEventsCursor = {
  eventTimestampMs: number;
  gatewayRequestId: string;
};

/** Throws when `raw` is not the JSON array of parts this service mints. */
function parseGroupKeyParts(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("summaries cursor payload is not a non-empty array");
  }
  if (!parsed.every((part) => typeof part === "string")) {
    throw new Error("summaries cursor payload holds a non-string part");
  }

  return parsed;
}

/** Opaque page cursors for the spend reads. */
/** Opaque, order-preserving page cursor: base64url "eventTs:requestId". */
export function encodeSpendEventsCursor(cursor: GatewaySpendEventsCursor): string {
  return Buffer.from(`${cursor.eventTimestampMs}:${cursor.gatewayRequestId}`, "utf8").toString(
    "base64url",
  );
}

/**
 * Opaque page cursor for the summaries rollup: base64url JSON array of
 * group-key parts, same conventions as {@link encodeSpendEventsCursor}.
 * Kept as an array since a group key is caller data that may contain any separator.
 */
export function encodeSpendSummariesCursor(groupKey: string[]): string {
  return Buffer.from(JSON.stringify(groupKey), "utf8").toString("base64url");
}

/**
 * Group-key parts a summaries cursor names, or null if not one this service
 * minted. Decided by parsing, never the first character — group keys are
 * caller data and may legitimately open with `[`.
 */
export function decodeSpendSummariesCursor(encoded: string): string[] | null {
  const raw = Buffer.from(encoded, "base64url").toString("utf8");
  if (raw.length === 0) return null;

  try {
    return parseGroupKeyParts(raw);
  } catch {
    // Not the minted array: the cursor is one group key that was never JSON.
    return [raw];
  }
}

export function decodeSpendEventsCursor(encoded: string): GatewaySpendEventsCursor | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const separatorIndex = raw.indexOf(":");
    if (separatorIndex <= 0) return null;

    const eventTimestampMs = Number(raw.slice(0, separatorIndex));
    const gatewayRequestId = raw.slice(separatorIndex + 1);
    if (
      !Number.isFinite(eventTimestampMs) ||
      eventTimestampMs < 0 ||
      gatewayRequestId.length === 0
    ) {
      return null;
    }

    return { eventTimestampMs, gatewayRequestId };
  } catch {
    return null;
  }
}
