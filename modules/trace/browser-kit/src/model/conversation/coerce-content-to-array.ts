/**
 * Coerces a message's `content` field to an array we can walk.
 */
export function coerceContentToArray(content: unknown): unknown[] | null {
  if (Array.isArray(content)) return content;
  if (typeof content !== "string") return null;

  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return null;

  const parsedJson = parseJson(trimmed);
  if (Array.isArray(parsedJson)) return parsedJson;

  const jsonified = pythonReprToJsonish(trimmed);
  const parsedPythonRepr = parseJson(jsonified);
  if (Array.isArray(parsedPythonRepr)) return parsedPythonRepr;

  return null;
}

function parseJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    // Invalid JSON is an expected signal to try the next representation.
    return null;
  }
}

/**
 * Convert a Python-repr-like string to a best-effort JSON string.
 */
function readPythonHexEscape(
  input: string,
  offset: number,
): { json: string; consumed: number } | null {
  if (input[offset] !== "\\" || input[offset + 1] !== "x") return null;
  const h1 = input[offset + 2];
  const h2 = input[offset + 3];
  if (h1 === undefined || h2 === undefined) return null;
  if (!/[0-9a-fA-F]/.test(h1) || !/[0-9a-fA-F]/.test(h2)) return null;
  return { json: `\\u00${h1}${h2}`, consumed: 4 };
}

type ReprState = "none" | "single" | "double";

type ReprStep = { text: string; consumed: number; state: ReprState };

const PYTHON_LITERALS: readonly (readonly [string, string])[] = [
  ["None", "null"],
  ["True", "true"],
  ["False", "false"],
];

const READ_BY_STATE: Record<ReprState, (input: string, offset: number) => ReprStep> = {
  none: readOutsideString,
  single: readSingleQuoted,
  double: readDoubleQuoted,
};

function pythonReprToJsonish(input: string): string {
  let out = "";
  let i = 0;
  let state: ReprState = "none";

  while (i < input.length) {
    const step: ReprStep = READ_BY_STATE[state](input, i);
    out += step.text;
    i += step.consumed;
    state = step.state;
  }

  return out;
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_]/.test(c);
}

/** None/True/False become JSON literals only at token boundaries. */
function readPythonLiteral(input: string, offset: number): ReprStep | null {
  if (isWordChar(input[offset - 1])) return null;
  for (const [word, json] of PYTHON_LITERALS) {
    if (input.startsWith(word, offset) && !isWordChar(input[offset + word.length])) {
      return { text: json, consumed: word.length, state: "none" };
    }
  }
  return null;
}

function readOutsideString(input: string, offset: number): ReprStep {
  const literal = readPythonLiteral(input, offset);
  if (literal !== null) return literal;
  const c = input[offset] ?? "";
  if (c === "'") return { text: '"', consumed: 1, state: "single" };
  if (c === '"') return { text: '"', consumed: 1, state: "double" };
  return { text: c, consumed: 1, state: "none" };
}

/** In a single-quoted string `\'` loses its backslash; `\xHH` becomes `\u00HH`. */
function readEscape(input: string, offset: number, state: ReprState): ReprStep {
  const next = input[offset + 1];
  if (state === "single" && next === "'") return { text: "'", consumed: 2, state };
  const hex = readPythonHexEscape(input, offset);
  if (hex !== null) return { text: hex.json, consumed: hex.consumed, state };
  if (next !== undefined) return { text: `\\${next}`, consumed: 2, state };
  return { text: "\\", consumed: 1, state };
}

function readSingleQuoted(input: string, offset: number): ReprStep {
  const c = input[offset] ?? "";
  if (c === "\\") return readEscape(input, offset, "single");
  if (c === "'") return { text: '"', consumed: 1, state: "none" };
  if (c === '"') return { text: '\\"', consumed: 1, state: "single" };
  return { text: c, consumed: 1, state: "single" };
}

function readDoubleQuoted(input: string, offset: number): ReprStep {
  const c = input[offset] ?? "";
  if (c === "\\") return readEscape(input, offset, "double");
  if (c === '"') return { text: '"', consumed: 1, state: "none" };
  return { text: c, consumed: 1, state: "double" };
}
