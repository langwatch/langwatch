/**
 * Heuristic to determine if text content likely overflows a cell.
 *
 * This avoids needing DOM measurement (useLayoutEffect + scrollHeight) which causes issues
 * with virtualization and column resizing. The heuristic counts characters and treats
 * each newline as equivalent to a full line of text.
 *
 * @param text - The text content to check
 * @param charThreshold - Character threshold before considering content as overflowing (default: 500)
 * @param charsPerLine - How many characters each newline counts as (default: 62)
 * @returns true if content likely overflows
 */
export const isTextLikelyOverflowing = (
  text: string,
  charThreshold = 500,
  charsPerLine = 62
): boolean => {
  // Count newlines and treat each as equivalent to charsPerLine characters
  const newlineCount = (text.match(/\n/g) || []).length;
  const effectiveLength = text.length + newlineCount * charsPerLine;

  return effectiveLength > charThreshold;
};
