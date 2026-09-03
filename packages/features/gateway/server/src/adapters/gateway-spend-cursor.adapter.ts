export type GatewaySpendEventsCursor = {
  eventTimestampMs: number;
  gatewayRequestId: string;
};

/** Opaque, order-preserving page cursor: base64url "eventTs:requestId". */
export function encodeSpendEventsCursor(cursor: GatewaySpendEventsCursor): string {
  return Buffer.from(`${cursor.eventTimestampMs}:${cursor.gatewayRequestId}`, "utf8").toString(
    "base64url",
  );
}

/**
 * Opaque page cursor for the summaries rollup: base64url of the JSON array of
 * group-key parts last served, one per grouping dimension. Same encoding
 * conventions as {@link encodeSpendEventsCursor} so a caller treats both
 * surfaces' cursors identically: opaque, and passed back verbatim.
 *
 * The parts are carried as an array rather than joined, because a group key
 * is a caller-supplied value (a model name, an end user id) and any separator
 * chosen for it is a separator some caller's data already contains.
 */
export function encodeSpendSummariesCursor(groupKey: string[]): string {
  return Buffer.from(JSON.stringify(groupKey), "utf8").toString("base64url");
}

/**
 * The group-key parts a summaries cursor names, or null when it is not a
 * cursor this service minted.
 *
 * Anything that is not a JSON array of strings is one part: cursors minted
 * before a rollup could group by two dimensions are plain base64url text, and
 * a caller can be mid-walk across the deploy that changed this.
 *
 * The decision is made by parsing, never by looking at the first character.
 * Group keys are caller data, so a model or end-user id may legitimately open
 * with `[`, and sniffing would refuse that caller's perfectly good cursor and
 * restart their walk from the first page.
 */
export function decodeSpendSummariesCursor(encoded: string): string[] | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    if (raw.length === 0) return null;

    const parts = tryParseGroupKeyParts(raw);
    return parts ?? [raw];
  } catch {
    return null;
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

function tryParseGroupKeyParts(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.every((part) => typeof part === "string") ? parsed : null;
  } catch {
    return null;
  }
}
