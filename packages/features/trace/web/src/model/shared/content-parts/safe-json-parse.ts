/**
 * Parses a JSON string, falling back to wrapping the raw text.
 *
 * Tool arguments and tool results arrive as strings that are *usually* JSON.
 * When one is not, the renderer still has to show something, so the raw text
 * is wrapped rather than thrown away.
 */
export const safeJsonParseOrStringFallback = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return { data: json };
  }
};
