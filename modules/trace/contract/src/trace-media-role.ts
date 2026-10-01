/**
 * Chat roles for media parts. Separate module to avoid cycles between collector
 * and ref. Vocabulary matches transcript parser; unknown roles show like pre-role.
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
