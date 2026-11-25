// Strip Liquid expressions by replacing {{ ... }} / {% ... %} with same-length placeholders
// that parse as valid JSON; preserves (line, column) positions for 1:1 mapping to original text.

export interface LiquidSubstitutionResult {
  /** Same-length copy of the source with Liquid spans neutralised. */
  substituted: string;
  /** The original spans we replaced — for debugging / position lookups. */
  liquidRanges: { start: number; end: number; kind: "output" | "tag" }[];
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

/** Where the next `{{` or `{%` starts (-1 when none), and whether it is an output. */
function nextLiquidStart(source: string, from: number): { at: number; isOutput: boolean } {
  const nextOutput = source.indexOf("{{", from);
  const nextTag = source.indexOf("{%", from);
  const at = nextOutput === -1 || (nextTag !== -1 && nextTag < nextOutput) ? nextTag : nextOutput;
  return { at, isOutput: at === nextOutput };
}

/**
 * The end of a passthrough block (`{% capture %}`, `{% comment %}`) opened by this span, or -1.
 * Its body is Liquid-only, so the whole region folds into one tag span; with no closer the
 * span falls through to the single-tag treatment and the editor flags the missing closer.
 */
function passthroughBlockEnd({
  source,
  span,
  end,
  isOutput,
}: {
  source: string;
  span: string;
  end: number;
  isOutput: boolean;
}): number {
  if (isOutput) return -1;
  const opener = PASSTHROUGH_OPENER_RE.exec(span);
  if (!opener) return -1;
  return findMatchingCloseTag(source, end, PASSTHROUGH_BLOCK_TAGS[opener[1]!]!);
}

function spanReplacement({
  source,
  next,
  span,
  isOutput,
}: {
  source: string;
  next: number;
  span: string;
  isOutput: boolean;
}): string {
  if (!isOutput) return fill(span, " ");
  if (isInsideString(source, next)) return fill(span, "_");
  if (span.length >= 2 && !span.includes("\n")) return `"${"_".repeat(span.length - 2)}"`;
  return fill(span, " ");
}

export function substituteLiquidForJsonValidation(source: string): LiquidSubstitutionResult {
  const liquidRanges: LiquidSubstitutionResult["liquidRanges"] = [];
  let out = "";
  let i = 0;

  while (i < source.length) {
    const { at: next, isOutput } = nextLiquidStart(source, i);
    if (next === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, next);

    const endIdx = source.indexOf(isOutput ? "}}" : "%}", next + 2);
    if (endIdx === -1) {
      // Unterminated Liquid — leave the rest as-is; the editor's Liquid tokenizer flags it,
      // and the JSON service reports wherever the substituted text next chokes.
      out += source.slice(next);
      break;
    }

    const end = endIdx + 2;
    const span = source.slice(next, end);
    const blockEnd = passthroughBlockEnd({ source, span, end, isOutput });
    if (blockEnd !== -1) {
      out += fill(source.slice(next, blockEnd), " ");
      liquidRanges.push({ start: next, end: blockEnd, kind: "tag" });
      i = blockEnd;
      continue;
    }

    out += spanReplacement({ source, next, span, isOutput });
    liquidRanges.push({ start: next, end, kind: isOutput ? "output" : "tag" });
    i = end;
  }

  return { substituted: out, liquidRanges };
}
