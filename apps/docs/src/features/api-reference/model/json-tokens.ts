/*
 * A JSON request body split into coloured runs for the playground's editor, in the code blocks'
 * github-light and github-dark colours. Typing leaves the body half-written, so anything the
 * pattern cannot read passes through as plain text.
 */
export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punctuation" | "plain";
export type JsonToken = { text: string; kind: JsonTokenKind };

/** Light and dark colours per kind, as the code blocks carry them (`--sl` and `--sd`). */
export const JSON_TOKEN_COLOURS: Readonly<
  Record<Exclude<JsonTokenKind, "plain">, { light: string; dark: string }>
> = {
  key: { light: "#005CC5", dark: "#79B8FF" },
  string: { light: "#032F62", dark: "#9ECBFF" },
  number: { light: "#005CC5", dark: "#79B8FF" },
  literal: { light: "#005CC5", dark: "#79B8FF" },
  punctuation: { light: "#24292E", dark: "#E1E4E8" },
};

/* A string, open or closed, then a colon that makes it a key; a number; a literal; punctuation. */
const TOKEN =
  /("(?:\\.|[^"\\\n])*"?)(?=(\s*:)?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

export function jsonTokens({ text }: { text: string }): JsonToken[] {
  const tokens: JsonToken[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, string, colon, number, literal] = match;
    if (match.index > at) tokens.push({ text: text.slice(at, match.index), kind: "plain" });
    let kind: JsonTokenKind = "punctuation";
    if (string !== undefined) kind = colon ? "key" : "string";
    else if (number !== undefined) kind = "number";
    else if (literal !== undefined) kind = "literal";
    tokens.push({ text: whole, kind });
    at = match.index + whole.length;
  }
  if (at < text.length) tokens.push({ text: text.slice(at), kind: "plain" });
  return tokens;
}
