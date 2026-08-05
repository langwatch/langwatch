/**
 * The Tags field shared by the virtual-key create and edit drawers: the copy
 * behind its (i), the input cap, and the parsing both drawers do on save.
 *
 * The two drawers render the same field, so the copy and the limits live here
 * rather than being written twice and drifting apart.
 */
import {
  VK_TAG_MAX_LENGTH,
  VK_TAGS_MAX_COUNT,
} from "~/server/gateway/virtualKey.config";

/**
 * The paragraph behind the field's (i). Everything a person needs before
 * typing a tag: what tags buy them, that the tags become visible on every
 * trace the key produces, that cache rules match on them, and what saving
 * does to a list that runs past the limits.
 *
 * The numbers are interpolated from the limits the server actually applies
 * (`normalizeVkTags`), so the copy cannot promise a bound the code does not
 * enforce. `virtualKeyTagsField.unit.test.ts` pins that.
 */
export const VK_TAGS_FIELD_DESCRIPTION =
  "Group this key's traffic by team, app, or environment. Every trace this " +
  "key sends carries its tags as labels, so anyone with access to the " +
  "project can see them and filter on them. A cache rule that lists tags " +
  "applies to any key carrying all of them. Saving keeps the first " +
  `${VK_TAGS_MAX_COUNT} tags, trims each to ${VK_TAG_MAX_LENGTH} ` +
  "characters, and drops blanks and repeats.";

/**
 * Cap for the field itself, which holds the whole tag list on one
 * comma-separated line: every tag at its full length, plus ", " between them.
 *
 * `maxLength` counts UTF-16 code units while `normalizeVkTags` counts code
 * points, and a code point can take two units, so the per-tag budget is
 * doubled. That way the field cap can never clip a list the server would have
 * kept whole; it only stops a runaway paste from getting that far.
 */
export const TAGS_CSV_MAX_LENGTH =
  VK_TAGS_MAX_COUNT * (VK_TAG_MAX_LENGTH * 2 + 2);

/** The typed line, split into the tags the drawer submits. */
export function parseTagsCsv(csv: string): string[] {
  return csv
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * What saving would quietly do to what is currently typed, or null when it
 * would keep every tag as written. Shown under the field only while it
 * applies, so a person never loses a tag without being told first.
 *
 * Repeats and blanks are left out on purpose: dropping them costs the person
 * nothing, and the (i) already says they go.
 */
export function tagsBeyondLimitsNotice(csv: string): string | null {
  const tags = parseTagsCsv(csv);
  const overCount = new Set(tags).size > VK_TAGS_MAX_COUNT;
  const overLength = tags.some((tag) => [...tag].length > VK_TAG_MAX_LENGTH);

  const notices: string[] = [];
  if (overCount) {
    notices.push(`Only the first ${VK_TAGS_MAX_COUNT} tags will be saved.`);
  }
  if (overLength) {
    notices.push(
      `Tags longer than ${VK_TAG_MAX_LENGTH} characters will be shortened.`,
    );
  }
  return notices.length > 0 ? notices.join(" ") : null;
}
