export type TextPart = { kind: "text" | "link"; value: string };

const URL_PATTERN = /https?:\/\/\S+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)'"\]}]+$/u;

/**
 * Splits a plain-text body into text and URLs, trimming the punctuation a
 * sentence leaves on a URL. The parts render as text nodes and anchors, so a
 * body containing markup stays the text it is.
 */
export const linkify = ({ text }: { text: string }): TextPart[] => {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const link = match[0].replace(TRAILING_PUNCTUATION, "");
    if (match.index > cursor) parts.push({ kind: "text", value: text.slice(cursor, match.index) });
    if (link !== "") parts.push({ kind: "link", value: link });
    cursor = match.index + link.length;
  }
  if (cursor < text.length) parts.push({ kind: "text", value: text.slice(cursor) });
  return parts;
};
