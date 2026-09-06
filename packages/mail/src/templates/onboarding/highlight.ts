/**
 * Token colouring for the code in an email, without a runtime.
 *
 * A mail client runs no JavaScript, so highlighting has to be in the markup
 * that arrives: every token is a `<span>` with a class the layout's stylesheet
 * promotes for dark. A real parser is not what this needs — the code in these
 * messages is three lines of setup we wrote ourselves, so a handful of rules
 * per language colours it correctly and a rule that misses colours a token as
 * plain text, which is the same thing the reader saw before.
 */

export const highlightLanguages = ["bash", "typescript", "python", "go"] as const;

export type HighlightLanguage = (typeof highlightLanguages)[number];

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "call" | "number";

export interface Token {
  kind: TokenKind;
  text: string;
}

/**
 * The words each language sets apart.
 *
 * Shell has no keywords, so the set is the commands these snippets run: in a
 * one-line install the command IS the thing worth seeing, and colouring
 * `install` the same as `npm` tells the reader nothing.
 */
const KEYWORDS: Record<HighlightLanguage, readonly string[]> = {
  bash: ["npm", "npx", "pip", "go", "export", "langwatch", "claude", "curl"],
  typescript: ["import", "from", "await", "const", "let", "async", "function", "export", "new"],
  python: ["import", "from", "def", "class", "with", "as", "return"],
  go: ["import", "func", "package", "var", "err", "return", "if", "go"],
};

/**
 * One pass, longest-lived thing first.
 *
 * Comments and strings are matched before identifiers because a keyword inside
 * either is not a keyword, and matching identifiers first is exactly how a
 * highlighter starts colouring the inside of a string.
 */
const SCANNER =
  /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)/g;

export const tokenize = (code: string, language: HighlightLanguage): Token[] => {
  const keywords = new Set(KEYWORDS[language]);
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of code.matchAll(SCANNER)) {
    const [text, comment, string, number, word] = match;
    if (match.index > cursor) {
      tokens.push({ kind: "plain", text: code.slice(cursor, match.index) });
    }
    cursor = match.index + text.length;

    if (comment) tokens.push({ kind: "comment", text });
    else if (string) tokens.push({ kind: "string", text });
    else if (number) tokens.push({ kind: "number", text });
    else if (word) {
      const callee = code[cursor] === "(";
      tokens.push({ kind: keywords.has(word) ? "keyword" : callee ? "call" : "plain", text });
    }
  }

  if (cursor < code.length) tokens.push({ kind: "plain", text: code.slice(cursor) });

  return merged(tokens);
};

/** Adjacent plain runs become one span, so the markup is not one span per word. */
const merged = (tokens: readonly Token[]): Token[] =>
  tokens.reduce<Token[]>((accumulated, token) => {
    const previous = accumulated[accumulated.length - 1];
    if (previous?.kind === "plain" && token.kind === "plain") {
      previous.text += token.text;

      return accumulated;
    }
    accumulated.push({ ...token });

    return accumulated;
  }, []);
