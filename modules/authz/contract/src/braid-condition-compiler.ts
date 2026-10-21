/**
 * ADR-183 §3: compiles a braid's condition, an OTTL subset, once on save into the tree the
 * fence renders, or refuses it by name with the construct, its offset in the text and a fix.
 * Pure and portable: the save path and the browser's condition editor run the same function.
 */
import {
  BRAID_CONDITION_COMPILER_VERSION,
  BRAID_CONDITION_MAX_DEPTH,
  BRAID_CONDITION_MAX_LENGTH,
  BRAID_CONDITION_MAX_TERMS,
  braidConditionTermsOf,
  compiledWhereSchema,
  type BraidConditionNode,
  type BraidConditionTerm,
} from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  braidConditionRefusalSchema,
  type BraidConditionRefusal,
  type BraidConditionRefusalCode,
} from "./authz.errors.ts";

/** A key `Verified("k")` may name: the signed entry keys of ADR-183 §4's wire format. */
export const BRAID_VERIFIED_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Accepted: the compiled tree, or none for an empty condition, which braids every owner span. */
const braidConditionCompiledSchemaDefinition = z
  .object({ ok: z.literal(true), compiledWhere: compiledWhereSchema.optional() })
  .strict();
export interface BraidConditionCompiledSchema extends Named<
  typeof braidConditionCompiledSchemaDefinition
> {}
export const braidConditionCompiledSchema: BraidConditionCompiledSchema =
  braidConditionCompiledSchemaDefinition;
const braidConditionCompileResultSchemaDefinition = z.discriminatedUnion("ok", [
  braidConditionCompiledSchema,
  braidConditionRefusalSchema,
]);
export interface BraidConditionCompileResultSchema extends Named<
  typeof braidConditionCompileResultSchemaDefinition
> {}
export const braidConditionCompileResultSchema: BraidConditionCompileResultSchema =
  braidConditionCompileResultSchemaDefinition;
export type BraidConditionCompileResult = z.infer<typeof braidConditionCompileResultSchema>;

const FIX = {
  comparison:
    'Start each comparison with attributes["k"], resource.attributes["k"] or name, for example attributes["k"] == "v".',
  or: "A condition cannot hold or; save one braid per alternative, since several braids read as their union.",
  not: 'A condition cannot negate; name what a braided span carries, for example attributes["k"] == "v".',
  function:
    'The only function is Verified("k"); compare whole values with ==, for example attributes["k"] == "v".',
  stringEquality:
    'Only string equality is supported: write attributes["k"] == "v" with the value in double quotes.',
  notEqualValue:
    'Name the value a braided span carries with ==, or require the key with attributes["k"] != nil.',
  emptyString:
    'A missing key reads as "", so == "" matches spans that never set it; write attributes["k"] != nil to require the key.',
  join: "Join comparisons with the lower-case word and.",
  verifiedKey:
    'Write Verified("k") with one signed entry key of 1 to 128 letters, digits, dots, dashes or underscores.',
  escape: 'Inside a string, escape only a double quote as \\" and a backslash as \\\\.',
  index: 'Index the attribute map once with a quoted key, for example attributes["k"].',
  presence: 'Presence is checked on span attributes only: write attributes["k"] != nil.',
  syntax: 'Complete the condition, for example attributes["k"] == "v" and name == "n".',
} as const;

type Token = {
  kind: "string" | "word" | "number" | "symbol" | "end";
  text: string;
  value: string;
  at: number;
};

/** Thrown inside the compiler only, and always caught by `compileBraidCondition`. */
class Refused extends Error {
  constructor(readonly refusal: BraidConditionRefusal) {
    super(refusal.code);
  }
}

function refuse({
  code,
  construct,
  at,
  fix,
  limit,
}: {
  code: BraidConditionRefusalCode;
  construct: string;
  at: number;
  fix: string;
  limit?: BraidConditionRefusal["limit"];
}): never {
  throw new Refused({ ok: false, code, construct, at, fix, ...(limit ? { limit } : {}) });
}

const unsupported = ({ construct, at, fix }: { construct: string; at: number; fix: string }) =>
  refuse({ code: "braid_condition_unsupported", construct, at, fix });
const malformed = ({ construct, at }: { construct: string; at: number }) =>
  refuse({ code: "braid_condition_syntax", construct, at, fix: FIX.syntax });

const SYMBOLS = [
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "(",
  ")",
  "[",
  "]",
  ".",
  ",",
  "<",
  ">",
  "=",
  "!",
];

function readString({ text, at }: { text: string; at: number }): Token {
  let value = "";
  for (let index = at + 1; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') return { kind: "string", text: text.slice(at, index + 1), value, at };
    if (char === "\\") {
      const escaped = text[index + 1];
      if (escaped !== '"' && escaped !== "\\") {
        return unsupported({
          construct: `the escape \\${escaped ?? ""}`,
          at: index,
          fix: FIX.escape,
        });
      }
      value += escaped;
      index++;
      continue;
    }
    value += char;
  }
  return malformed({ construct: "an unclosed string", at });
}

function tokenise({ text }: { text: string }): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const take = (kind: Token["kind"], end: number) => {
    const slice = text.slice(at, end);
    tokens.push({ kind, text: slice, value: slice, at });
    at = end;
  };
  while (at < text.length) {
    const rest = text.slice(at);
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    const number = /^-?[0-9][0-9.eE+-]*/.exec(rest);
    const symbol = SYMBOLS.find((candidate) => rest.startsWith(candidate));
    if (/^\s/.test(rest)) at++;
    else if (rest.startsWith('"')) {
      const token = readString({ text, at });
      tokens.push(token);
      at += token.text.length;
    } else if (word) take("word", at + word[0].length);
    else if (number) take("number", at + number[0].length);
    else if (symbol) take("symbol", at + symbol.length);
    else {
      const char = String.fromCodePoint(text.codePointAt(at)!);
      unsupported({ construct: `the character ${char}`, at, fix: FIX.comparison });
    }
  }
  tokens.push({ kind: "end", text: "", value: "", at: text.length });
  return tokens;
}

const isWord = (token: Token, word: string) => token.kind === "word" && token.text === word;
const isSymbol = (token: Token, symbol: string) => token.kind === "symbol" && token.text === symbol;
const ORDERING = new Set(["<", "<=", ">", ">="]);

class ConditionParser {
  private position = 0;
  private depth = 0;
  private comparisons = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): BraidConditionNode {
    const node = this.conjunction();
    const token = this.peek();
    if (token.kind === "end") return node;
    if (isSymbol(token, ")"))
      malformed({ construct: "an unmatched closing parenthesis", at: token.at });
    return this.unexpected(token);
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token = this.peek();
    this.position = Math.min(this.position + 1, this.tokens.length - 1);
    return token;
  }

  private conjunction(): BraidConditionNode {
    const operands = [this.operand()];
    while (isWord(this.peek(), "and")) {
      const and = this.next();
      const following = this.peek();
      if (following.kind === "end" || isSymbol(following, ")")) {
        malformed({ construct: "a dangling and", at: and.at });
      }
      operands.push(this.operand());
    }
    return operands.length === 1 ? operands[0]! : { kind: "and", terms: operands };
  }

  private operand(): BraidConditionNode {
    const token = this.peek();
    if (isSymbol(token, "(")) return this.group();
    if (token.kind === "end" || isSymbol(token, ")") || isWord(token, "and")) {
      return malformed({ construct: "a missing comparison", at: token.at });
    }
    if (isWord(token, "not") || isSymbol(token, "!")) {
      return unsupported({ construct: "not", at: token.at, fix: FIX.not });
    }
    if (isWord(token, "or") || isSymbol(token, "||")) {
      return unsupported({ construct: "or", at: token.at, fix: FIX.or });
    }
    if (token.kind === "word" && isSymbol(this.peek(1), "(")) {
      return token.text === "Verified"
        ? this.counted(token, this.verified())
        : unsupported({ construct: token.text, at: token.at, fix: FIX.function });
    }
    if (token.kind === "string" || token.kind === "number") {
      return unsupported({
        construct: "a literal before its path",
        at: token.at,
        fix: FIX.comparison,
      });
    }
    return this.counted(token, this.comparison());
  }

  private counted(start: Token, term: BraidConditionTerm): BraidConditionTerm {
    this.comparisons++;
    if (this.comparisons > BRAID_CONDITION_MAX_TERMS) {
      refuse({
        code: "braid_condition_too_large",
        construct: `more than ${BRAID_CONDITION_MAX_TERMS} comparisons`,
        at: start.at,
        fix: "Split the condition across braids, or drop comparisons that every braided span shares.",
        limit: "comparisons",
      });
    }
    return term;
  }

  private group(): BraidConditionNode {
    const open = this.next();
    this.depth++;
    if (this.depth > BRAID_CONDITION_MAX_DEPTH) {
      refuse({
        code: "braid_condition_too_large",
        construct: `parentheses nested more than ${BRAID_CONDITION_MAX_DEPTH} deep`,
        at: open.at,
        fix: "Remove parentheses: every comparison is joined with and, so grouping never changes the meaning.",
        limit: "depth",
      });
    }
    const node = this.conjunction();
    const close = this.peek();
    if (close.kind === "end") malformed({ construct: "an unclosed parenthesis", at: open.at });
    if (!isSymbol(close, ")")) this.unexpected(close);
    this.next();
    this.depth--;
    return node;
  }

  private verified(): BraidConditionTerm {
    const name = this.next();
    this.next();
    const key = this.next();
    if (key.kind !== "string" || !BRAID_VERIFIED_KEY_PATTERN.test(key.value)) {
      unsupported({
        construct: "a Verified key outside [A-Za-z0-9._-]{1,128}",
        at: key.at,
        fix: FIX.verifiedKey,
      });
    }
    const close = this.next();
    if (isSymbol(close, ",")) {
      unsupported({
        construct: "Verified with more than one key",
        at: close.at,
        fix: FIX.verifiedKey,
      });
    }
    if (!isSymbol(close, ")")) malformed({ construct: "an unclosed Verified(", at: name.at });
    return { kind: "verified", key: key.value };
  }

  private comparison(): BraidConditionTerm {
    const path = this.path();
    const operator = this.next();
    const value = this.next();
    if (isSymbol(operator, "==")) return this.equals({ path, value });
    if (isSymbol(operator, "!=")) return this.present({ path, value });
    if (operator.kind === "symbol" && ORDERING.has(operator.text)) {
      const construct = value.kind === "string" ? "an ordering comparison" : "a numeric comparison";
      return unsupported({ construct, at: operator.at, fix: FIX.stringEquality });
    }
    if (isSymbol(operator, "="))
      return unsupported({ construct: "=", at: operator.at, fix: FIX.stringEquality });
    return unsupported({
      construct: "a path without a comparison",
      at: operator.at,
      fix: FIX.comparison,
    });
  }

  private equals({ path, value }: { path: Path; value: Token }): BraidConditionTerm {
    if (value.kind === "string") {
      if (value.value === "")
        return unsupported({ construct: "an empty string", at: value.at, fix: FIX.emptyString });
      return path.on === "name"
        ? { kind: "nameEquals", value: value.value }
        : { kind: "attributeEquals", on: path.on, key: path.key, value: value.value };
    }
    if (isWord(value, "true") || isWord(value, "false")) {
      return unsupported({
        construct: `a comparison with ${value.text}`,
        at: value.at,
        fix: FIX.stringEquality,
      });
    }
    if (value.kind === "number") {
      return unsupported({
        construct: "a numeric comparison",
        at: value.at,
        fix: FIX.stringEquality,
      });
    }
    if (value.kind === "word") {
      return unsupported({
        construct: `a comparison with ${value.text}`,
        at: value.at,
        fix: FIX.stringEquality,
      });
    }
    return malformed({ construct: "a comparison without a value", at: value.at });
  }

  private present({ path, value }: { path: Path; value: Token }): BraidConditionTerm {
    if (!isWord(value, "nil")) {
      if (value.kind === "end")
        return malformed({ construct: "a comparison without a value", at: value.at });
      return unsupported({ construct: "!= with a value", at: value.at, fix: FIX.notEqualValue });
    }
    if (path.on !== "span") {
      return unsupported({ construct: `${path.text} != nil`, at: path.at, fix: FIX.presence });
    }
    return { kind: "attributePresent", key: path.key };
  }

  private path(): Path {
    const start = this.next();
    if (isWord(start, "name")) return { on: "name", key: "", text: "name", at: start.at };
    if (isWord(start, "resource")) {
      const dot = this.next();
      const map = this.next();
      if (!isSymbol(dot, ".") || !isWord(map, "attributes")) {
        return unsupported({
          construct: `the path resource${dot.text}${map.text}`,
          at: start.at,
          fix: FIX.comparison,
        });
      }
      return {
        on: "resource",
        key: this.index(start),
        text: "resource.attributes[...]",
        at: start.at,
      };
    }
    if (isWord(start, "attributes")) {
      return { on: "span", key: this.index(start), text: "attributes[...]", at: start.at };
    }
    if (start.kind === "word") {
      return unsupported({
        construct: `the path ${start.text}`,
        at: start.at,
        fix: FIX.comparison,
      });
    }
    return malformed({ construct: `an unexpected ${start.text}`, at: start.at });
  }

  private index(start: Token): string {
    const open = this.next();
    if (!isSymbol(open, "[")) {
      return unsupported({ construct: "the whole attribute map", at: start.at, fix: FIX.index });
    }
    const key = this.next();
    if (key.kind === "end") return malformed({ construct: "an unclosed [", at: open.at });
    if (key.kind !== "string")
      return unsupported({ construct: "an unquoted key", at: key.at, fix: FIX.index });
    if (key.value === "")
      return unsupported({ construct: "an empty attribute key", at: key.at, fix: FIX.index });
    if (!isSymbol(this.next(), "]")) malformed({ construct: "an unclosed [", at: open.at });
    if (isSymbol(this.peek(), "[")) {
      unsupported({ construct: "a nested index", at: this.peek().at, fix: FIX.index });
    }
    return key.value;
  }

  private unexpected(token: Token): never {
    if (isWord(token, "or") || isSymbol(token, "||"))
      unsupported({ construct: "or", at: token.at, fix: FIX.or });
    if (isWord(token, "not")) unsupported({ construct: "not", at: token.at, fix: FIX.not });
    if (token.kind === "word" || isSymbol(token, "&&")) {
      unsupported({ construct: token.text, at: token.at, fix: FIX.join });
    }
    return malformed({ construct: `an unexpected ${token.text || "end"}`, at: token.at });
  }
}

type Path = { on: "span" | "resource" | "name"; key: string; text: string; at: number };

/** Compiles `text` once, on save; the browser runs the same call for live feedback. */
/** A term as JSON with its fields in a fixed order, so equal terms compare equal. */
function canonicalTerm(term: BraidConditionTerm): string {
  switch (term.kind) {
    case "attributeEquals":
      return JSON.stringify([term.kind, term.on, term.key, term.value]);
    case "nameEquals":
      return JSON.stringify([term.kind, term.value]);
    case "attributePresent":
    case "verified":
      return JSON.stringify([term.kind, term.key]);
  }
}

/** One flat conjunction, deduplicated and sorted: equivalent conditions share a tree and digest. */
function canonicalTree(node: BraidConditionNode): BraidConditionNode {
  const byCanonical = new Map(
    braidConditionTermsOf(node).map((term) => [canonicalTerm(term), term]),
  );
  const terms = [...byCanonical.keys()]
    .toSorted((left, right) => Number(left > right) - Number(left < right))
    .map((key) => byCanonical.get(key)!);
  return terms.length === 1 ? terms[0]! : { kind: "and", terms };
}

export function compileBraidCondition({ text }: { text: string }): BraidConditionCompileResult {
  if (text.length > BRAID_CONDITION_MAX_LENGTH) {
    return {
      ok: false,
      code: "braid_condition_too_large",
      construct: `more than ${BRAID_CONDITION_MAX_LENGTH} characters`,
      at: BRAID_CONDITION_MAX_LENGTH,
      fix: "Shorten the condition, or split it across braids.",
      limit: "characters",
    };
  }
  if (text.trim() === "") return { ok: true, compiledWhere: undefined };
  try {
    const tree = canonicalTree(new ConditionParser(tokenise({ text })).parse());
    const compiledWhere = compiledWhereSchema.parse({
      version: BRAID_CONDITION_COMPILER_VERSION,
      tree,
    });
    return { ok: true, compiledWhere };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}
