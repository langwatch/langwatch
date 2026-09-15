/**
 * Coerces arbitrary text into a string `handleSchema` accepts. A prompt is not
 * guaranteed to have a handle - legacy configs predate them and their id
 * carries uppercase - and a handle that fails the schema silently forces the
 * prompt into draft mode when it is reopened.
 */
export function toHandleSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "prompt";
}
