/**
 * Convert a Python-repr literal (single-quoted strings, None/True/False) to
 * JSON so browser preview parsing can inspect payloads logged via `repr()`.
 */
export function pythonReprToJson(input: string): string | null {
  const first = input[0];
  if (first !== "[" && first !== "{") return null;
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "'" || ch === '"') {
      const scanned = scanReprString({ input, openIndex: i });
      if (scanned === null) return null;
      out += `"${scanned.body}"`;
      i = scanned.nextIndex;
      continue;
    }
    if (input.startsWith("None", i)) {
      out += "null";
      i += 4;
      continue;
    }
    if (input.startsWith("True", i)) {
      out += "true";
      i += 4;
      continue;
    }
    if (input.startsWith("False", i)) {
      out += "false";
      i += 5;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function scanReprString({
  input,
  openIndex,
}: {
  input: string;
  openIndex: number;
}): { body: string; nextIndex: number } | null {
  const quote = input[openIndex]!;
  let body = "";
  let i = openIndex + 1;
  while (i < input.length) {
    const character = input[i]!;
    if (character === "\\") {
      const next = input[i + 1];
      if (next === "'") {
        body += "'";
      } else if (next === "x" || next === "X") {
        body += "\\u00" + input.slice(i + 2, i + 4);
        i += 4;
        continue;
      } else {
        body += "\\" + (next ?? "");
      }
      i += 2;
      continue;
    }
    if (character === quote) return { body, nextIndex: i + 1 };
    body += escapeReprCharacter(character);
    i++;
  }
  return null;
}

function escapeReprCharacter(character: string): string {
  if (character === '"') return '\\"';
  if (character === "\n") return "\\n";
  if (character === "\t") return "\\t";
  if (character === "\r") return "\\r";
  return character;
}
