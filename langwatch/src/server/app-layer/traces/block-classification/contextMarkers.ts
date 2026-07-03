/**
 * Leading-context marker detection (ADR-033 Decision 3, shared pure module).
 *
 * Coding agents prepend large `<system-reminder>`, `<mcp-instructions>` and
 * skill XML blocks ABOVE the human text in the first user message. This module
 * peels those leading `<tag>…</tag>` blocks off the front of a string and maps
 * each tag to a cost category — injected context is NOT user input.
 *
 * This is the shared home of the marker set the ADR calls for: the server
 * classifier consumes {@link splitLeadingMarkers}, and the UI's
 * `splitLeadingContextBlocks` (features/traces-v2/utils/leadingContext.ts) is a
 * caller of the same core loop. The loop here is a superset of that util —
 * it returns the same context/body split plus a per-block category — so it can
 * replace leadingContext's core in a later PR without behavioural drift.
 */

import { InputCategory, MAX_LEADING_MARKERS } from "./categories";

/** A leading `<tag>…</tag>` block peeled off the front of a user string. */
export interface LeadingMarkerBlock {
  /** The tag name (e.g. `system-reminder`), lowercased. */
  tagName: string;
  /** The full `<tag>…</tag>` block text, including the tags. */
  raw: string;
  /** The cost category this marker maps to. */
  category: InputCategory;
}

export interface LeadingMarkerSplit {
  /** Leading marker blocks, in order (empty when there are none). */
  markers: LeadingMarkerBlock[];
  /** The text that followed the leading markers. */
  body: string;
}

// Matches a (whitespace-allowed) opening tag, capturing leading whitespace
// (group 1) and the tag name (group 2). Same shape as the UI util's
// LEADING_OPEN_TAG, but STICKY (`y`) rather than `^`-anchored so the peel loop
// can advance a cursor via `lastIndex` instead of re-slicing the remaining
// string each iteration — the sticky flag pins each match to the cursor, which
// keeps the whole peel linear in input length (see splitLeadingMarkers).
const LEADING_OPEN_TAG = /(\s*)<([a-zA-Z][\w-]*)(?:\s[^>]*)?>/y;

/**
 * Tags that map to skill content. Claude Code injects skill instructions under
 * `<skill>` / `<skills-list>`, and slash-command expansions as a
 * `<command-name>` + `<command-message>` pair.
 */
const SKILL_MARKER_TAGS: ReadonlySet<string> = new Set([
  "skill",
  "skills-list",
  "command-name",
  "command-message",
  "command-args",
]);

/**
 * Maps a leading marker tag to its cost category. `system-reminder` is injected
 * context (prior_context), NOT user input; `mcp-instructions` is MCP tool
 * definition text; skill tags are skill content; any other leading tag is
 * treated as injected prior context (unknown ⇒ prior_context, never user_input).
 */
export function categoryForMarkerTag(tagName: string): InputCategory {
  const tag = tagName.toLowerCase();
  if (tag === "system-reminder") return InputCategory.PRIOR_CONTEXT;
  if (tag === "mcp-instructions") return InputCategory.MCP_TOOL_DEFINITIONS;
  if (SKILL_MARKER_TAGS.has(tag)) return InputCategory.SKILL_CONTENT;
  return InputCategory.PRIOR_CONTEXT;
}

/**
 * Peels complete `<tag>…</tag>` blocks off the FRONT of `text`. Stops at the
 * first non-tag content, so tags interleaved with or following real prose are
 * left untouched — only prepended context is separated. Pure and deterministic:
 * no clock, no randomness, no I/O.
 */
/** True when the char at `idx` ends an opening tag name (`>`, whitespace, or a
 * self-close `/`), so `<skill` matches `<skill>`/`<skill attr>` but not
 * `<skills-list>`. */
function endsTagName(text: string, idx: number): boolean {
  const c = text[idx];
  return (
    c === ">" ||
    c === "/" ||
    c === " " ||
    c === "\t" ||
    c === "\n" ||
    c === "\r"
  );
}

/**
 * Return the index just past the close tag that MATCHES the opening tag at
 * `from` (which is positioned just after the `<tagName…>` open), accounting for
 * nested same-name tags — a naive first-`indexOf` closes at the inner tag and
 * leaks a dangling `</tag>` into the body. Returns -1 when unbalanced. Tag names
 * are `[A-Za-z][\w-]*` (no regex-special chars), so plain `indexOf` is safe.
 */
function matchingCloseEnd({
  text,
  tagName,
  from,
}: {
  text: string;
  tagName: string;
  from: number;
}): number {
  const openLt = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  let depth = 1;
  let i = from;
  while (depth > 0) {
    const closeIdx = text.indexOf(closeTag, i);
    if (closeIdx === -1) return -1; // unbalanced — bail, leave as body
    let openIdx = text.indexOf(openLt, i);
    // Only a real nested open (proper tag-name boundary) before the close counts.
    while (openIdx !== -1 && !endsTagName(text, openIdx + openLt.length)) {
      openIdx = text.indexOf(openLt, openIdx + openLt.length);
    }
    if (openIdx !== -1 && openIdx < closeIdx) {
      depth++;
      i = openIdx + openLt.length;
    } else {
      depth--;
      i = closeIdx + closeTag.length;
    }
  }
  return i;
}

export function splitLeadingMarkers(text: string): LeadingMarkerSplit {
  const markers: LeadingMarkerBlock[] = [];

  // Advance a cursor over `text` — never re-slice the tail (that would make the
  // peel O(n²) on adversarial leading-tag spam, on the synchronous ingest path).
  // Sticky `LEADING_OPEN_TAG.lastIndex = pos` pins each match to the cursor, and
  // we slice out only the small `raw` block, so the whole loop is linear.
  let pos = 0;
  while (markers.length < MAX_LEADING_MARKERS) {
    LEADING_OPEN_TAG.lastIndex = pos;
    const open = LEADING_OPEN_TAG.exec(text);
    if (!open) break;
    const leadingWhitespace = open[1] ?? "";
    const tagName = open[2]!;
    let blockEnd = matchingCloseEnd({
      text,
      tagName,
      from: pos + open[0].length,
    });
    if (blockEnd === -1) {
      // Depth-matching hit an imbalance — almost always because the block BODY
      // contains a literal `<tag` (e.g. a reminder telling the model NOT to
      // re-emit `<system-reminder>`), not a truly unbalanced document. Fall back
      // to the first close so we peel THIS block instead of discarding every
      // marker and dumping the whole message into user_input. Worst case is the
      // naive matcher's mis-scope, not total marker loss.
      const closeTag = `</${tagName}>`;
      const firstClose = text.indexOf(closeTag, pos + open[0].length);
      if (firstClose === -1) break;
      blockEnd = firstClose + closeTag.length;
    }
    const raw = text.slice(pos + leadingWhitespace.length, blockEnd);
    markers.push({
      tagName: tagName.toLowerCase(),
      raw,
      category: categoryForMarkerTag(tagName),
    });
    pos = blockEnd;
  }

  if (markers.length === 0) return { markers: [], body: text };
  return { markers, body: text.slice(pos).replace(/^\s+/, "") };
}
