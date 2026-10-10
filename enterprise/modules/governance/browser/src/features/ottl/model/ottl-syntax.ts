import type { OttlValidationError } from "@langwatch/enterprise-governance-contract";

export type OttlTokenKind =
  | "function"
  | "path"
  | "string"
  | "number"
  | "keyword"
  | "literal"
  | "operator"
  | "punctuation"
  | "text";

export type OttlSegment = Readonly<{ text: string; kind: OttlTokenKind; isError: boolean }>;

const KEYWORDS = new Set(["where", "and", "or", "not"]);
const LITERALS = new Set(["true", "false", "nil"]);
const TOKEN =
  /("(?:[^"\\]|\\.)*"?)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)|(\d+(?:\.\d+)?)|(==|!=|<=|>=|[<>+\-*/])|([()[\],.{}:])|(\s+|.)/gsy;
const UNEXPECTED_TOKEN = /unexpected token "((?:[^"\\]|\\.)*)"/;

function kindOf(match: RegExpExecArray): OttlTokenKind {
  if (match[1] !== undefined) return "string";
  if (match[2] !== undefined) return "function";
  const word = match[3];
  if (word !== undefined) {
    if (KEYWORDS.has(word)) return "keyword";
    return LITERALS.has(word) ? "literal" : "path";
  }
  if (match[4] !== undefined) return "number";
  if (match[5] !== undefined) return "operator";
  return match[6] !== undefined ? "punctuation" : "text";
}

/** The parser's line/col as a character range; no position underlines the whole statement. */
export function ottlErrorRange({ text, error }: { text: string; error: OttlValidationError }): {
  start: number;
  end: number;
} {
  const lastChar = Math.max(0, text.trimEnd().length - 1);
  if (error.line <= 0 || error.col <= 0) return { start: 0, end: text.length };
  const token = UNEXPECTED_TOKEN.exec(error.message)?.[1];
  if (token === "<EOF>") return { start: lastChar, end: lastChar + 1 };
  const lines = text.split("\n");
  const lineStart = lines.slice(0, error.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
  const start = Math.min(lineStart + error.col - 1, lastChar);
  return { start, end: start + Math.max(1, token?.length ?? 1) };
}

/** Tokenizes a statement for colouring, splitting tokens where the error range cuts them. */
export function ottlSegments({
  text,
  error,
}: {
  text: string;
  error: OttlValidationError | null;
}): OttlSegment[] {
  const range = error ? ottlErrorRange({ text, error }) : null;
  const segments: OttlSegment[] = [];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    const kind = kindOf(match);
    const from = match.index;
    const to = from + match[0].length;
    const cuts = [from, to];
    if (range) cuts.push(...[range.start, range.end].filter((at) => at > from && at < to));
    cuts.sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const [a = 0, b = 0] = [cuts[i], cuts[i + 1]];
      const isError = range !== null && a >= range.start && a < range.end;
      segments.push({ text: text.slice(a, b), kind, isError });
    }
  }
  return segments;
}
