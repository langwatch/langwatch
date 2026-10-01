/**
 * The Tags field shared by the virtual-key create and edit drawers: the
 * copy behind its (i), the input cap, and the parsing both do on save —
 * living here so the two drawers can't drift apart.
 */
import { VK_TAG_MAX_LENGTH, VK_TAGS_MAX_COUNT } from "@langwatch/gateway-contract";

/**
 * The paragraph behind the field's (i). Describes what tags are, how they
 * appear on traces, and what saving does with lists past the limits.
 */
export const VK_TAGS_FIELD_DESCRIPTION =
  "Group this key's traffic by team, app, or environment. Every trace this " +
  "key sends carries its tags as labels, so anyone with access to the " +
  "project can see them and filter on them. A cache rule that lists tags " +
  "applies to any key carrying all of them. Saving keeps the first " +
  `${VK_TAGS_MAX_COUNT} tags, trims each to ${VK_TAG_MAX_LENGTH} ` +
  "characters, and drops blanks and repeats.";

/**
 * Cap for the field holding the whole tag list as comma-separated text.
 * Accounts for UTF-16 encoding; doubled to prevent clipping valid lists.
 */
export const TAGS_CSV_MAX_LENGTH = VK_TAGS_MAX_COUNT * (VK_TAG_MAX_LENGTH * 2 + 2);

/** The typed line, split into the tags the drawer submits. */
export function parseTagsCsv(csv: string): string[] {
  return csv
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * What saving would quietly do to what is typed, or null if unchanged.
 * Shown only while it applies, so nobody loses a tag unwarned. Repeats and
 * blanks drop silently — the (i) already says they go.
 */
export function tagsBeyondLimitsNotice(csv: string): string | null {
  const tags = parseTagsCsv(csv);
  const overCount = new Set(tags).size > VK_TAGS_MAX_COUNT;
  const overLength = tags.some((tag) => Array.from(tag).length > VK_TAG_MAX_LENGTH);

  const notices: string[] = [];
  if (overCount) {
    notices.push(`Only the first ${VK_TAGS_MAX_COUNT} tags will be saved.`);
  }
  if (overLength) {
    notices.push(`Tags longer than ${VK_TAG_MAX_LENGTH} characters will be shortened.`);
  }
  return notices.length > 0 ? notices.join(" ") : null;
}
