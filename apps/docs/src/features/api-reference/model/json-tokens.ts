/*
 * JSON split into the runs the docs colour: keys, strings and other values. Code examples, the
 * playground's body editor and its live response all read it, and the docs.css `docs-json-*`
 * classes colour it. A half-written body passes through as plain text where it cannot be read.
 */
export type JsonTokenKind = "key" | "string" | "value" | "plain";
export type JsonToken = { text: string; kind: JsonTokenKind };

/* A string, open or closed, then a colon that makes it a key; or a literal or number. */
const TOKEN =
  /("(?:\\.|[^"\\\n])*"?)(?=(\s*:)?)|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;

export function jsonTokens({ text }: { text: string }): JsonToken[] {
  const tokens: JsonToken[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, string, colon] = match;
    if (match.index > at) tokens.push({ text: text.slice(at, match.index), kind: "plain" });
    let kind: JsonTokenKind = "value";
    if (string !== undefined) kind = colon ? "key" : "string";
    tokens.push({ text: whole, kind });
    at = match.index + whole.length;
  }
  if (at < text.length) tokens.push({ text: text.slice(at), kind: "plain" });
  return tokens;
}
