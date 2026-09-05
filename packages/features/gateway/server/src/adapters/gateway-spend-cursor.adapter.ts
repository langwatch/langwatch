export type GatewaySpendEventsCursor = {
  eventTimestampMs: number;
  gatewayRequestId: string;
};

function tryParseGroupKeyParts(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.every((part) => typeof part === "string") ? parsed : null;
  } catch {
    return null;
  }
}

/** Opaque page cursors for the spend reads. */
export class GatewaySpendCursorAdapter {
  static create(): GatewaySpendCursorAdapter {
    return new GatewaySpendCursorAdapter();
  }

  private constructor() {}

  /** Opaque, order-preserving page cursor: base64url "eventTs:requestId". */
  encodeSpendEventsCursor(cursor: GatewaySpendEventsCursor): string {
    return Buffer.from(`${cursor.eventTimestampMs}:${cursor.gatewayRequestId}`, "utf8").toString(
      "base64url",
    );
  }

  /**
   * Opaque page cursor for the summaries rollup: base64url JSON array of group-key parts, one per dimension, same conventions as {@link encodeSpendEventsCursor}. Kept as an array since a group key is caller data and any separator is one some data already carries.
   */
  encodeSpendSummariesCursor(groupKey: string[]): string {
    return Buffer.from(JSON.stringify(groupKey), "utf8").toString("base64url");
  }

  /**
   * Group-key parts a summaries cursor names, or null if not one this service minted. Decided by parsing, never the first character — group keys are caller data and may legitimately open with `[`.
   */
  decodeSpendSummariesCursor(encoded: string): string[] | null {
    try {
      const raw = Buffer.from(encoded, "base64url").toString("utf8");
      if (raw.length === 0) return null;

      const parts = tryParseGroupKeyParts(raw);
      return parts ?? [raw];
    } catch {
      return null;
    }
  }

  decodeSpendEventsCursor(encoded: string): GatewaySpendEventsCursor | null {
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
}
