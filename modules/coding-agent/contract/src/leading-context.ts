// Separate leading XML context blocks from human text for display-only
// purposes; list shows text, pretty view collapses context blocks.

export interface LeadingContextSplit {
  /** The leading `<tag>…</tag>` blocks, joined (empty when there are none). */
  context: string;
  /**
   * The same blocks, still separate. A surface that draws one line per block
   * reads these rather than cutting `context` back apart on the same rule this
   * peeled it with, which would go quietly wrong the moment the rule changes.
   */
  blocks: string[];
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

  if (blocks.length === 0) return { context: "", blocks, body: text };
  return {
    context: blocks.join("\n\n"),
    blocks,
    body: rest.replace(/^\s+/, ""),
  };
}
