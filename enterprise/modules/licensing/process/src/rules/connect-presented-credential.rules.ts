/** What the connect host reads from a presented credential (ADR-156, section 6). */

/** The credential out of a bearer header, or the empty string, which is malformed. */
export function bearerTokenOf(header: string | undefined): string {
  const value = header?.trim() ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice("bearer ".length).trim() : "";
}
