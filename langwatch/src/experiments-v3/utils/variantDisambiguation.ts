/**
 * Comparison variant names are only distinct because callers happen to pick
 * differently-named prompts. When two or more variants resolve to the same
 * name (e.g. the same prompt run twice with a different config), the
 * scoreboard/verdict UI otherwise renders identical labels with no way to tell
 * which is which (#5502-adjacent customer feedback, 2026-07-08).
 *
 * What actually differs between same-name variants isn't always the model — it
 * could be temperature, a prompt edit, or anything else — so this doesn't try
 * to guess a differentiator. It appends a plain "(1)" / "(2)" suffix in variant
 * order; the rendered comparison view separately lets you click a variant name
 * to highlight its source column.
 *
 * Names that are unique, and empty names (a target still loading), pass through
 * untouched.
 */
export const disambiguateNames = (names: string[]): string[] => {
  const occurrences = new Map<string, number>();
  for (const name of names) {
    if (!name) continue;
    occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
  }

  const numbered = new Map<string, number>();
  return names.map((name) => {
    if (!name || (occurrences.get(name) ?? 0) < 2) return name;
    const ordinal = (numbered.get(name) ?? 0) + 1;
    numbered.set(name, ordinal);
    return `${name} (${ordinal})`;
  });
};
