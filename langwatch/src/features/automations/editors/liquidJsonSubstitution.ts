/**
 * Strips Liquid expressions out of a `liquid-json` source string by replacing
 * each `{{ ... }}` / `{% ... %}` span with a same-length placeholder that
 * parses as valid JSON in its context. Because every replacement preserves
 * length and newline placement, any (line, column) the JSON language service
 * computes on the substituted text matches the same position in the original
 * text — the editor's schema markers map back 1:1 without an offset table.
 *
 * Heuristics for what to substitute with:
 *
 * • `{{ expr }}` *inside* a JSON string → fill non-newline chars with `_`.
 *   The surrounding string stays well-formed; the schema sees a longer string.
 *
 * • `{{ expr }}` *outside* a string (a JSON value slot) → wrap in quotes so
 *   the slot becomes a string literal: `"_____"`. Block Kit values that admit
 *   Liquid expressions are always strings, so the schema accepts it. (If the
 *   user puts Liquid where a non-string was required, the schema will flag
 *   "expected X got string" — accurate enough.)
 *
 * • `{% tag %}` → fill non-newline chars with ` `. Tags read as whitespace,
 *   which JSON ignores. A `{% for %}…{% endfor %}` wrapping structural JSON
 *   may still produce invalid JSON (e.g. trailing commas); that's the
 *   inherent limit of static validation over a dynamic template and the
 *   resulting marker is on real syntax the user can act on.
 */

export interface LiquidSubstitutionResult {
  /** Same-length copy of the source with Liquid spans neutralised. */
  substituted: string;
  /** The original spans we replaced — for debugging / position lookups. */
  liquidRanges: Array<{ start: number; end: number; kind: "output" | "tag" }>;
}

function fill(span: string, char: string): string {
  let out = "";
  for (const ch of span) out += ch === "\n" ? "\n" : char;
  return out;
}

function isInsideString(source: string, position: number): boolean {
  let inString = false;
  let i = 0;
  while (i < position) {
    const ch = source.charCodeAt(i);
    if (ch === 0x5c /* \ */ && inString) {
      i += 2;
      continue;
    }
    if (ch === 0x22 /* " */) inString = !inString;
    i++;
  }
  return inString;
}

export function substituteLiquidForJsonValidation(
  source: string,
): LiquidSubstitutionResult {
  const liquidRanges: LiquidSubstitutionResult["liquidRanges"] = [];
  let out = "";
  let i = 0;

  while (i < source.length) {
    const nextOutput = source.indexOf("{{", i);
    const nextTag = source.indexOf("{%", i);
    const next =
      nextOutput === -1
        ? nextTag
        : nextTag === -1
          ? nextOutput
          : Math.min(nextOutput, nextTag);

    if (next === -1) {
      out += source.slice(i);
      break;
    }

    out += source.slice(i, next);

    const isOutput = next === nextOutput;
    const endMarker = isOutput ? "}}" : "%}";
    const endIdx = source.indexOf(endMarker, next + 2);
    if (endIdx === -1) {
      // Unterminated Liquid — leave the rest as-is; the editor's own Liquid
      // tokenizer will visually flag it, and the substituted text falling
      // through will let the JSON service report wherever it next chokes.
      out += source.slice(next);
      break;
    }

    const end = endIdx + 2;
    const span = source.slice(next, end);
    const spanLength = end - next;

    let replacement: string;
    if (!isOutput) {
      replacement = fill(span, " ");
    } else if (isInsideString(source, next)) {
      replacement = fill(span, "_");
    } else if (spanLength >= 2 && !span.includes("\n")) {
      replacement = `"${"_".repeat(spanLength - 2)}"`;
    } else {
      replacement = fill(span, " ");
    }

    out += replacement;
    liquidRanges.push({
      start: next,
      end,
      kind: isOutput ? "output" : "tag",
    });
    i = end;
  }

  return { substituted: out, liquidRanges };
}
