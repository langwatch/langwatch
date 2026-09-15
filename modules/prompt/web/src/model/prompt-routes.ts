/**
 * The one address this screen builds for itself.
 *
 * `platform/app/src/utils/routes.ts` is a 383-line route table with seven other
 * importers; the span hand-off needs a single entry from it. Stated here rather
 * than copied whole, because a page family that owns one address does not need
 * the product's whole map.
 */

/** `/:project/prompts`, the address a span is handed off to. */
export function promptStudioPath(projectSlug: string): string {
  return `/${projectSlug}/prompts`.replace(/\/\/+/g, "/");
}
