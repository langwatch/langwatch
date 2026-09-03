/**
 * The first user-perceived character of a string — one grapheme cluster, not
 * one UTF-16 code unit.
 *
 * `"🚩 Langy".charAt(0)` and `.slice(0, 1)` both cut an astral character in
 * half and leave a lone surrogate, which browsers paint as the replacement
 * box. Every avatar that shows an initial is one emoji-prefixed name away
 * from that, and customers do name projects with emoji.
 *
 * `Intl.Segmenter` also keeps sequences together that are several code points
 * long — a ZWJ family, a country flag, a skin-tone modifier — which iterating
 * code points alone would still split. The code-point fallback is for
 * engines without it, where a plain surrogate pair is at least kept whole.
 */
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
