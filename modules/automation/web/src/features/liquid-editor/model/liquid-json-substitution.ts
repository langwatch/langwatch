// Strip Liquid expressions by replacing {{ ... }} / {% ... %} with same-length placeholders
// that parse as valid JSON; preserves (line, column) positions for 1:1 mapping to original text.

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

/** Block-tag pairs whose body never contributes to JSON output — the body
 *  is either a string declaration (`{% capture %}`) or a comment. Treating
 *  the whole region as one tag span is correct AND avoids the per-span
 *  treatment turning `{{ ... }}` inside the body into `"___"` at top-level
 *  (which then trips JSON validation). */
const PASSTHROUGH_BLOCK_TAGS: Record<string, string> = {
  capture: "endcapture",
  comment: "endcomment",
};

/** Matches `{% [-]?\s*tagName\b ...` so we can recognise the opener for the
 *  passthrough tags above. The `\b` boundary keeps `captured` etc. from
 *  matching `capture`. */
const PASSTHROUGH_OPENER_RE = new RegExp(
  `^\\{%-?\\s*(${Object.keys(PASSTHROUGH_BLOCK_TAGS).join("|")})\\b`,
);

function findMatchingCloseTag(
  source: string,
  startAfterOpenerEnd: number,
  closerName: string,
): number {
  // Allow whitespace and an optional leading `-` between `{%` and the tag
  // name to mirror Liquid's whitespace-trim variants.
  const closerRe = new RegExp(`\\{%-?\\s*${closerName}\\s*-?%\\}`);
  const m = closerRe.exec(source.slice(startAfterOpenerEnd));
  if (!m) return -1;
  return startAfterOpenerEnd + m.index + m[0].length;
}

export function substituteLiquidForJsonValidation(source: string): LiquidSubstitutionResult {
  const liquidRanges: LiquidSubstitutionResult["liquidRanges"] = [];
  let out = "";
  let i = 0;

  while (i < source.length) {
    const nextOutput = source.indexOf("{{", i);
    const nextTag = source.indexOf("{%", i);
    const next =
      nextOutput === -1 ? nextTag : nextTag === -1 ? nextOutput : Math.min(nextOutput, nextTag);

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

    // Passthrough block tags (`{% capture %}…{% endcapture %}`,
    // `{% comment %}…{% endcomment %}`): the body is a Liquid-only string
    // declaration (or pure documentation), never inlined into the JSON.
    // Per-span substitution would wrap embedded `{{ ... }}` in `"___"` at
    // top level, producing invalid JSON and a misleading marker — fold
    // the whole region into one tag span instead.
    const passthroughOpener = !isOutput ? PASSTHROUGH_OPENER_RE.exec(span) : null;
    if (passthroughOpener) {
      const closerName = PASSTHROUGH_BLOCK_TAGS[passthroughOpener[1]!]!;
      const blockEnd = findMatchingCloseTag(source, end, closerName);
      if (blockEnd !== -1) {
        const blockSpan = source.slice(next, blockEnd);
        out += fill(blockSpan, " ");
        liquidRanges.push({ start: next, end: blockEnd, kind: "tag" });
        i = blockEnd;
        continue;
      }
      // No closer — fall through to the single-tag treatment so the user
      // still gets a clean span replacement up to `%}` and the editor's
      // Liquid tokenizer can visually flag the missing closer.
    }

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
