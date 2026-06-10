/**
 * Claude Code (and similar agents) prepend large `<system-reminder>`,
 * MCP-instruction and skills-list XML blocks ABOVE the actual human text in
 * the first user message. That boilerplate drowns the real message in the
 * trace list preview and the pretty conversation view.
 *
 * `splitLeadingContextBlocks` separates those leading tag blocks from the
 * human text that follows so each surface can decide what to do: the list
 * shows the human text, the pretty view collapses the context behind a
 * disclosure.
 *
 * Display-only — callers never persist the result back onto the span.
 */

export interface LeadingContextSplit {
  /** The leading `<tag>…</tag>` blocks, joined (empty when there are none). */
  context: string;
  /** The text that followed the leading context blocks. */
  body: string;
}

// Matches a leading (whitespace-allowed) opening tag, capturing the tag name.
// Group 1 is the leading whitespace, group 2 the tag name.
const LEADING_OPEN_TAG = /^(\s*)<([a-zA-Z][\w-]*)(?:\s[^>]*)?>/;

/**
 * Peels complete `<tag>…</tag>` blocks off the FRONT of `text`. Stops at the
 * first non-tag content, so tags interleaved with or following real prose are
 * left untouched — only the prepended context is separated.
 */
export function splitLeadingContextBlocks(text: string): LeadingContextSplit {
  let rest = text;
  const blocks: string[] = [];

  while (true) {
    const open = LEADING_OPEN_TAG.exec(rest);
    if (!open) break;
    const leadingWhitespace = open[1] ?? "";
    const tagName = open[2]!;
    const closeTag = `</${tagName}>`;
    const closeIdx = rest.indexOf(closeTag, open[0].length);
    if (closeIdx === -1) break;
    const blockEnd = closeIdx + closeTag.length;
    blocks.push(rest.slice(leadingWhitespace.length, blockEnd));
    rest = rest.slice(blockEnd);
  }

  if (blocks.length === 0) return { context: "", body: text };
  return { context: blocks.join("\n\n"), body: rest.replace(/^\s+/, "") };
}
