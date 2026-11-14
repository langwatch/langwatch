/* A label names a family by a whole word; a word after a dot is a file extension, not a choice. */
const FAMILIES: readonly (readonly [string, RegExp])[] = [
  ["typescript", /(?<!\.)\b(typescript|javascript|ts|js|tsx|jsx|node|nodejs|node\.js)\b/],
  ["python", /(?<!\.)\b(python|py)\b/],
  ["go", /\b(go|golang)\b/],
  ["java", /\bjava\b/],
  ["shell", /(?<!\.)\b(curl|bash|shell|sh|zsh)\b/],
  ["rust", /\brust\b/],
  ["ruby", /\bruby\b/],
  ["php", /\bphp\b/],
  ["csharp", /(^|[^\w#])(c#|csharp|\.net|dotnet)(?![\w#])/],
];

/** The language a tab label offers, so one choice can select the same language everywhere. */
export function languageFamily({ label }: { label: string }): string | null {
  const lower = label.trim().toLowerCase();
  return FAMILIES.find(([, pattern]) => pattern.test(lower))?.[0] ?? null;
}

/** Each tab's family from its names (label first), or none when the group offers fewer than two. */
export function tabFamilies({ tabs }: { tabs: string[][] }): (string | null)[] {
  const families = tabs.map(
    (candidates) =>
      candidates.map((label) => languageFamily({ label })).find((family) => family) ?? null,
  );
  return new Set(families.filter(Boolean)).size >= 2 ? families : families.map(() => null);
}
