/**
 * Estimates whether text will overflow a virtualized table cell without DOM measurement.
 */
export const isTextLikelyOverflowing = (
  text: string,
  charThreshold = 500,
  charsPerLine = 62,
): boolean => {
  const newlineCount = (text.match(/\n/g) || []).length;
  const effectiveLength = text.length + newlineCount * charsPerLine;

  return effectiveLength > charThreshold;
};
