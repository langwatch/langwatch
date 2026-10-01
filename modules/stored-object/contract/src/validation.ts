export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const isControlCodePoint =
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
    if (isControlCodePoint) {
      return true;
    }
  }
  return false;
}
