/**
 * Detects an assistant reply that is really a structured value.
 *
 * A prompt with more than one declared output field streams its result as a
 * JSON object. Rendered as markdown that reads as a wall of braces, so the
 * surfaces that expect structured output render it as a tree instead.
 */
/**
 * Attempts to parse a string as JSON.
 * Returns the parsed object if successful, undefined otherwise.
 */
export function tryParseJson(content: string | undefined): object | undefined {
  if (!content || typeof content !== "string") {
    return undefined;
  }

  const trimmed = content.trim();
  // Quick check: must start with { to be a JSON object
  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    // Only accept objects, not arrays or primitives
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
