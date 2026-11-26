/** What an error with no recognizable class name is recorded as. */
const UNTYPED_ERROR_SHAPE = "untyped_error";

/**
 * Reduce raw job errors to something safe to keep in a durable audit row.
 */
export function summarizeErrorShapes(messages: string[]): string[] {
  const shapes = new Set<string>();
  for (const message of messages) {
    const named = /^([A-Za-z][A-Za-z0-9_]*(?:Error|Exception))\b/.exec(message);
    shapes.add(named?.[1]?.slice(0, 80) ?? UNTYPED_ERROR_SHAPE);
    if (shapes.size >= 5) {
      break;
    }
  }

  return [...shapes];
}
