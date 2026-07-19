/**
 * Coerces a message's `content` field to an array we can walk.
 *
 * Some SDK callers (notably the langwatch python-sdk) used to send
 * `content` as a stringified Python-repr of a list
 * (`"[{'type': 'input_audio', ...}]"`) instead of a JSON-encoded array.
 * Newer SDK versions emit JSON directly; this function keeps the
 * Python-repr fallback for older clients in flight.
 *
 * Returns:
 *  - The array verbatim when content is already an array.
 *  - A parsed array when content is a string that decodes (JSON or
 *    Python-repr) to an array of objects.
 *  - null otherwise (caller should pass through unchanged).
 */
export function coerceContentToArray(content: unknown): unknown[] | null {
  if (Array.isArray(content)) return content;
  if (typeof content !== "string") return null;

  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to Python-repr recovery
  }

  const jsonified = pythonReprToJsonish(trimmed);
  try {
    const parsed = JSON.parse(jsonified) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // give up
  }

  return null;
}

/**
 * Convert a Python-repr-like string to a best-effort JSON string.
 *
 * Walks character-by-character with a tiny quote state machine so that
 * single-to-double quote flipping only happens outside string literals.
 * The naive `replace(/'/g, '"')` approach broke on payloads like
 * `"i'm at a cafe"` (Python switches to outer double quotes when the
 * string contains an apostrophe), turning `i'm` into `i"m` and breaking
 * JSON.parse.
 *
 * Bare-identifier replacements (`None` -> `null`, `True` -> `true`,
 * `False` -> `false`) likewise only fire outside strings.
 *
 * This is a recovery fallback for legacy SDK output. New senders should
 * JSON-encode their content directly; do not lean on this function as
 * an excuse to keep emitting Python repr.
 */
/**
 * If ``input`` at ``offset`` begins with a Python ``\xHH`` byte escape,
 * return its JSON ``\u00HH`` equivalent and the number of source chars
 * consumed (always 4). Returns ``null`` otherwise.
 *
 * JSON.parse rejects ``\xHH`` outright; without this translation the
 * recovery path returns null on any Python repr that contains a control
 * byte (rare in chat content but well within spec).
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

function pythonReprToJsonish(input: string): string {
  let out = "";
  let i = 0;
  // 'none' = outside any string. 'single' / 'double' = inside a string
  // literal originally delimited by ' / ".
  let state: "none" | "single" | "double" = "none";

  const isWordChar = (c: string | undefined): boolean =>
    c !== undefined && /[A-Za-z0-9_]/.test(c);

  const matchIdentifier = (word: string): boolean =>
    input.startsWith(word, i) && !isWordChar(input[i + word.length]);

  while (i < input.length) {
    const c = input[i] ?? "";

    if (state === "none") {
      // Bare-identifier replacements only at token boundaries so
      // substrings like "None" inside an unquoted-but-unlikely region
      // don't false-positive. (We're already outside any string here.)
      const prev = input[i - 1];
      if (!isWordChar(prev)) {
        if (matchIdentifier("None")) {
          out += "null";
          i += 4;
          continue;
        }
        if (matchIdentifier("True")) {
          out += "true";
          i += 4;
          continue;
        }
        if (matchIdentifier("False")) {
          out += "false";
          i += 5;
          continue;
        }
      }

      if (c === "'") {
        out += '"';
        state = "single";
      } else if (c === '"') {
        out += '"';
        state = "double";
      } else {
        out += c;
      }
      i++;
      continue;
    }

    if (state === "single") {
      if (c === "\\") {
        // Translate the most common Python escape sequences into their
        // JSON equivalents. `\'` is illegal in JSON (the outer quote
        // is now `"` so the apostrophe doesn't need escaping); `\"`
        // becomes `\"` (the same in both formats since we're inside a
        // double-quoted string in the output).
        const next = input[i + 1];
        if (next === "'") {
          out += "'";
          i += 2;
          continue;
        }
        if (next === '"') {
          out += '\\"';
          i += 2;
          continue;
        }
        const hex = readPythonHexEscape(input, i);
        if (hex !== null) {
          out += hex.json;
          i += hex.consumed;
          continue;
        }
        if (next !== undefined) {
          // Pass through other escapes verbatim (\n, \t, \\, \uXXXX
          // all share semantics between Python and JSON).
          out += c + next;
          i += 2;
          continue;
        }
        out += c;
        i++;
        continue;
      }
      if (c === "'") {
        out += '"';
        state = "none";
        i++;
        continue;
      }
      if (c === '"') {
        // Literal double quote inside a Python single-quoted string —
        // must be escaped now that the outer quote is `"`.
        out += '\\"';
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    // state === "double"
    if (c === "\\") {
      const hex = readPythonHexEscape(input, i);
      if (hex !== null) {
        out += hex.json;
        i += hex.consumed;
        continue;
      }
      const next = input[i + 1];
      if (next !== undefined) {
        out += c + next;
        i += 2;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      out += '"';
      state = "none";
      i++;
      continue;
    }
    // Apostrophes inside Python-double-quoted strings stay verbatim:
    // they're valid inside JSON double-quoted strings unescaped.
    out += c;
    i++;
  }

  return out;
}
