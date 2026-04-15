/** Normalize an error message for clustering by replacing volatile tokens. */
export function normalizeErrorMessage(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "<IP>")
    .replace(/:\d{2,5}\b/g, ":<PORT>")
    .replace(/\b\d{10,}\b/g, "<ID>")
    .replace(/\s+/g, " ")
    .trim();
}
