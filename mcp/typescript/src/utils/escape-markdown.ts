/**
 * Escapes characters that would break markdown table formatting:
 * replaces `|` with `\|` and newlines with spaces.
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
