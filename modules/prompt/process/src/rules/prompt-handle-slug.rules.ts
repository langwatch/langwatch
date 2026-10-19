/**
 * Coerces arbitrary text into a string `handleSchema` accepts. Legacy
 * configs predate handles and their id carries uppercase; a handle failing
 * the schema silently forces the prompt into draft mode when reopened.
 */
export function toHandleSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "prompt";
}
