const HEX_DIGIT = /[0-9a-fA-F]/;

/**
 * Converts a Python-repr-like string to a best-effort JSON string with a quote state machine, so
 * quote flipping and bare-identifier replacement only fire outside string literals — a naive
 * replace broke on payloads like "i'm at a cafe". `\xHH` escapes become `\u00HH` for JSON.parse.
 */
function readPythonHexEscape(
  input: string,
  offset: number,
): { json: string; consumed: number } | null {
  if (input[offset] !== "\\" || input[offset + 1] !== "x") {
    return null;
  }

  const h1 = input[offset + 2];
  const h2 = input[offset + 3];
  if (h1 === undefined || h2 === undefined) {
    return null;
  }

  const bothAreHexDigits = HEX_DIGIT.test(h1) && HEX_DIGIT.test(h2);
  if (!bothAreHexDigits) {
    return null;
  }

  return { json: `\\u00${h1}${h2}`, consumed: 4 };
}

/** Where the walk stands: outside any string, or inside one the source delimited with ' or ". */
type ReprState = "none" | "single" | "double";

/** What one character position contributes: text to emit, how far to move, and any new state. */
interface ReprStep {
  emit: string;
  consumed: number;
  state?: ReprState;
}

function isWordChar(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

/**
 * Outside a string. Bare identifiers are replaced only at token boundaries, so a word merely
 * containing "None" is left alone, and either quote opens a JSON double-quoted string.
 */
function stepOutsideString(input: string, i: number): ReprStep {
  const matchIdentifier = (word: string): boolean =>
    input.startsWith(word, i) && !isWordChar(input[i + word.length]);
  if (!isWordChar(input[i - 1])) {
    if (matchIdentifier("None")) {
      return { emit: "null", consumed: 4 };
    }

    if (matchIdentifier("True")) {
      return { emit: "true", consumed: 4 };
    }

    if (matchIdentifier("False")) {
      return { emit: "false", consumed: 5 };
    }
  }

  const c = input[i] ?? "";
  if (c === "'") {
    return { emit: '"', consumed: 1, state: "single" };
  }

  if (c === '"') {
    return { emit: '"', consumed: 1, state: "double" };
  }

  return { emit: c, consumed: 1 };
}

/**
 * Inside a string the source single-quoted. The outer quote is now `"`, so an escaped apostrophe
 * loses its backslash and a literal double quote gains one; other escapes mean the same in both.
 */
function stepInSingleQuoted(input: string, i: number): ReprStep {
  const c = input[i] ?? "";
  if (c === "\\") {
    const next = input[i + 1];
    if (next === "'") {
      return { emit: "'", consumed: 2 };
    }

    if (next === '"') {
      return { emit: '\\"', consumed: 2 };
    }

    const hex = readPythonHexEscape(input, i);
    if (hex !== null) {
      return { emit: hex.json, consumed: hex.consumed };
    }

    return next !== undefined ? { emit: c + next, consumed: 2 } : { emit: c, consumed: 1 };
  }

  if (c === "'") {
    return { emit: '"', consumed: 1, state: "none" };
  }

  return c === '"' ? { emit: '\\"', consumed: 1 } : { emit: c, consumed: 1 };
}

/**
 * Inside a string the source double-quoted. Apostrophes stay verbatim, being valid unescaped
 * inside a JSON string, and only the byte escape needs translating.
 */
function stepInDoubleQuoted(input: string, i: number): ReprStep {
  const c = input[i] ?? "";
  if (c === "\\") {
    const hex = readPythonHexEscape(input, i);
    if (hex !== null) {
      return { emit: hex.json, consumed: hex.consumed };
    }

    const next = input[i + 1];

    return next !== undefined ? { emit: c + next, consumed: 2 } : { emit: c, consumed: 1 };
  }

  if (c === '"') {
    return { emit: '"', consumed: 1, state: "none" };
  }

  return { emit: c, consumed: 1 };
}

const STEP_BY_STATE: Record<ReprState, (input: string, i: number) => ReprStep> = {
  none: stepOutsideString,
  single: stepInSingleQuoted,
  double: stepInDoubleQuoted,
};

function pythonReprToJsonish(input: string): string {
  let out = "";
  let i = 0;
  let state: ReprState = "none";
  while (i < input.length) {
    const step: ReprStep = STEP_BY_STATE[state](input, i);
    out += step.emit;
    i += step.consumed;
    if (step.state) {
      state = step.state;
    }
  }

  return out;
}

export class TraceContentArrayService {
  static create(): TraceContentArrayService {
    return new TraceContentArrayService();
  }

  /**
   * Coerces a message's content field to an array we can walk. Older python-sdk callers sent
   * content as a stringified Python repr of a list rather than JSON; newer ones emit JSON, and
   * this keeps the repr fallback for clients still in flight. Returns null when neither decodes.
   */
  static tryCoerceContentToArray(content: unknown): unknown[] | null {
    if (Array.isArray(content)) {
      return content;
    }

    if (typeof content !== "string") {
      return null;
    }

    const trimmed = content.trim();
    if (!trimmed.startsWith("[")) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // fall through to Python-repr recovery
    }

    const jsonified = pythonReprToJsonish(trimmed);
    try {
      const parsed = JSON.parse(jsonified) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // give up
    }

    return null;
  }
}
