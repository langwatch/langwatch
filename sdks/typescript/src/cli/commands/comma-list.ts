/** A comma list as its items: trimmed, blanks dropped, a repeat kept at its first place. */
export function parseCommaList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
}
