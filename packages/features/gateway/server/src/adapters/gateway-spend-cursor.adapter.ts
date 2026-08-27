export type GatewaySpendEventsCursor = {
  eventTimestampMs: number;
  gatewayRequestId: string;
};

export function encodeSpendEventsCursor(cursor: GatewaySpendEventsCursor): string {
  return Buffer.from(
    `${cursor.eventTimestampMs}:${cursor.gatewayRequestId}`,
    "utf8",
  ).toString("base64url");
}

export function encodeSpendSummariesCursor(groupKey: string[]): string {
  return Buffer.from(JSON.stringify(groupKey), "utf8").toString("base64url");
}

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

export function decodeSpendEventsCursor(
  encoded: string,
): GatewaySpendEventsCursor | null {
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
