/**
 * Escapes characters that would break markdown table formatting.
 *
 * Replaces pipe characters (`|`) with `\|` and newlines with spaces
 * so that values can be safely embedded in markdown tables and headers.
 */
export function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}
