/* React writes `hidden` only as a boolean; a findable panel (accordion, tab) wants until-found. */
const FINDABLE_TAG = /<[a-z][\w-]*\s[^>]*\bdata-docs-findable=""[^>]*>/g;

/** Rewrites prerendered findable panels to `hidden="until-found"`, so find-in-page reaches them. */
export function findableMarkup({ html }: { html: string }): string {
  return html.replace(FINDABLE_TAG, (tag) => tag.replace(/\shidden=""/, ' hidden="until-found"'));
}
