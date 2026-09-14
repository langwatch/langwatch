/** First grapheme cluster, not UTF-16 unit. Handles emoji and sequences via Intl.Segmenter. */
export function firstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    const first = segmenter.segment(trimmed)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return Array.from(trimmed)[0] ?? "";
}
