/**
 * Extracts {{variable}} names from a handlebars-style prompt string.
 * Only matches well-formed tokens: double braces, identifier characters only,
 * no spaces inside. Returns deduplicated names in appearance order.
 */
export function parseHandlebars(prompt: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of prompt.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)) {
    const name = match[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}
