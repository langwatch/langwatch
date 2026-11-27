/**
 * A forgiving lexer for one-line filter expressions in the OTTL family (`attributes["k"] == "v"
 * and Verified("k")`). It only colours text: it never refuses, and its tokens join back to the
 * input exactly, so a highlighted layer lines up character for character with what was typed.
 */

export type ExpressionTokenKind =
  | "keyword"
  | "function"
  | "field"
  | "string"
  | "number"
  | "operator"
  | "punctuation"
  | "plain";

export type ExpressionToken = { kind: ExpressionTokenKind; text: string; at: number };

const KEYWORDS = new Set(["and", "or", "not", "nil", "true", "false"]);
const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "=", "!"];
const PUNCTUATION = new Set(["(", ")", "[", "]", "{", "}", ".", ","]);

/** The end of a double-quoted string starting at `at`, or the text's end when it is unclosed. */
function stringEnd({ text, at }: { text: string; at: number }): number {
  for (let index = at + 1; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === '"') return index + 1;
  }
  return text.length;
}

function wordKind({ text, word, end }: { text: string; word: string; end: number }) {
  if (KEYWORDS.has(word)) return "keyword";
  return /^\s*\(/.test(text.slice(end)) ? "function" : "field";
}

export function tokeniseExpression({ text }: { text: string }): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let at = 0;
  const push = (kind: ExpressionTokenKind, end: number) => {
    const last = tokens.at(-1);
    if (kind === "plain" && last?.kind === "plain") last.text += text.slice(at, end);
    else tokens.push({ kind, text: text.slice(at, end), at });
    at = end;
  };
  while (at < text.length) {
    const rest = text.slice(at);
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0];
    const number = /^-?[0-9][0-9.eE+-]*/.exec(rest)?.[0];
    const operator = OPERATORS.find((candidate) => rest.startsWith(candidate));
    if (rest.startsWith('"')) push("string", stringEnd({ text, at }));
    else if (word) push(wordKind({ text, word, end: at + word.length }), at + word.length);
    else if (number) push("number", at + number.length);
    else if (operator) push("operator", at + operator.length);
    else if (PUNCTUATION.has(rest[0]!)) push("punctuation", at + 1);
    else push("plain", at + String.fromCodePoint(rest.codePointAt(0)!).length);
  }
  return tokens;
}

/** Each kind's colour: the palettes the JSON preview and the trace search already use. */
export const EXPRESSION_TOKEN_COLOR: Record<ExpressionTokenKind, string> = {
  keyword: "purple.fg",
  function: "blue.fg",
  field: "cyan.fg",
  string: "green.fg",
  number: "orange.fg",
  operator: "pink.fg",
  punctuation: "fg.muted",
  plain: "fg",
};
