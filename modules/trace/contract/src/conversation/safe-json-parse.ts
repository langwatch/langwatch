/**
 * Parses a JSON string, falling back to wrapping the raw text. Tool
 * arguments/results arrive as strings that are *usually* JSON; when not,
 * the raw text is wrapped rather than thrown away.
 */
export const safeJsonParseOrStringFallback = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return { data: json };
  }
};
