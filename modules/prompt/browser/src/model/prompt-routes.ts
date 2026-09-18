/**
 * The one address this screen builds for itself. `platform/app`'s route
 * table has 383 lines and seven other importers; stated here rather than
 * copied whole, since a page family owning one address needs no whole map.
 */

/** `/:project/prompts`, the address a span is handed off to. */
export function promptStudioPath(projectSlug: string): string {
  return `/${projectSlug}/prompts`.replace(/\/\/+/g, "/");
}
