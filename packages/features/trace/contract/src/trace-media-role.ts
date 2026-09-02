/**
 * The chat roles a media part can be attributed to.
 *
 * Its own module because both halves of the media pipeline need it and each
 * needs the other: the walk (`trace-media-part.collector.ts`) reads a role off
 * a message envelope, and the reference shape (`trace-media-ref.ts`) carries
 * it and is built from what the walk collected. Left in either file the two
 * import each other in a cycle.
 *
 * Same vocabulary the transcript parser accepts for a message envelope;
 * anything else is treated as "no role", which every consumer reads as "show
 * it wherever it would have shown before roles existed".
 */
export const MEDIA_PART_ROLES = [
  "system",
  "user",
  "assistant",
  "tool",
  "developer",
  "function",
] as const;

export type MediaPartRole = (typeof MEDIA_PART_ROLES)[number];

const MEDIA_PART_ROLE_SET: ReadonlySet<string> = new Set(MEDIA_PART_ROLES);

/** True for a role string the walk is willing to attribute a part to. */
export function isMediaPartRole(value: unknown): value is MediaPartRole {
  return typeof value === "string" && MEDIA_PART_ROLE_SET.has(value);
}
