// When multiple variants have the same name, append "(1)", "(2)" suffixes in
// variant order so they're distinguishable. Unique and empty names pass
// through untouched.
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
