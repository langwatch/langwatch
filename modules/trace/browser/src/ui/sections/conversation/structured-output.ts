/**
 * Detects an assistant reply that is really a structured value: a prompt
 * with more than one declared output field streams JSON, which reads as a
 * wall of braces as markdown — surfaces expecting it render a tree instead.
 */
export function findStructuredOutput(content: string | undefined): object | undefined {
  if (!content || typeof content !== "string") {
    return undefined;
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
