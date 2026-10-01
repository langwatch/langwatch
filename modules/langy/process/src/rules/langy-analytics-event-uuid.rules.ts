import { createHash } from "node:crypto";

/**
 * A UUID that is the same for every delivery of one event, so an analytics sink that dedups on
 * the event uuid keeps exactly one of them.
 */
export function analyticsUuidForEvent(eventId: string): string {
  const hex = createHash("sha256").update(`langy-analytics:${eventId}`).digest("hex");
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
