/**
 * Moves leading reasoning headlines into the completed-actions receipt.
 * Only short leading bold paragraphs are eligible, and only when the turn has
 * activity. Ordinary emphasis stays untouched. A glued headline needs an
 * earlier standalone headline as evidence, and the fold never empties the
 * answer. Recorded `reasoning` parts contribute through the same path.
 */

import { z } from "zod";

const MAX_TITLE_CHARS = 80;

/** A single-line bold run at the head of the remaining text. */
const LEADING_BOLD = /^\*\*([^*\n]+)\*\*/;

const reasoningPartSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
  })
  .loose();
type ReasoningPart = z.infer<typeof reasoningPartSchema>;

export interface ReasoningTitleFold {
  /** The folded headlines, in stream order, for the completed receipt. */
  titles: string[];
  /** The answer text with the leading headline paragraphs peeled off. */
  text: string;
}

/**
 * True when a bold run reads as a reasoning-summary headline rather than the
 * model emphasising part of its answer: short, multi-word, and free of
 * sentence punctuation (a title states a topic; a sentence ends).
 */
function looksLikeReasoningTitle(candidate: string): boolean {
  const title = candidate.trim();
  if (!title || title.length > MAX_TITLE_CHARS) return false;
  if (!/\s/.test(title)) return false;
  if (/[.!?:;,]$/.test(title)) return false;
  if (/[.!?:;]/.test(title)) return false;
  return true;
}

/** The headline of a `reasoning` part: its first non-empty line, unbolded. */
function titleOfReasoningPart(part: ReasoningPart): string | null {
  const firstLine = (part.text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  const bold = LEADING_BOLD.exec(firstLine);
  const title = bold?.[1] ?? firstLine;
  return title.trim() || null;
}

/**
 * Peel the leading `**Title**` paragraphs off a settled answer.
 *
 * Standalone headlines (the bold run is the whole paragraph) peel repeatedly.
 * A GLUED headline peels on evidence: either a standalone run came before it,
 * or it is glued to yet another headline — consecutive reasoning segments with
 * no tool call between them arrive as `**a****b**`, which no answer's own
 * markdown looks like. Severing the last glue is what lets the reply start as
 * its own block.
 */
function peelLeadingTitles(text: string): { titles: string[]; text: string } {
  const titles: string[] = [];
  let rest = text;

  for (;;) {
    const lead = rest.replace(/^\s+/, "");
    const bold = LEADING_BOLD.exec(lead);
    const title = bold?.[1];
    if (!bold || !title || !looksLikeReasoningTitle(title)) break;
    const after = lead.slice(bold[0].length);
    const standalone = after === "" || after.startsWith("\n");
    const nextBold = LEADING_BOLD.exec(after);
    const nextTitle = nextBold?.[1];
    const gluedToAnotherTitle =
      nextTitle !== void 0 && looksLikeReasoningTitle(nextTitle);
    // A lone bold run glued to plain prose is the model's own emphasis
    // ("**Very important** never…") — leave it be.
    if (!standalone && titles.length === 0 && !gluedToAnotherTitle) break;
    titles.push(title.trim());
    rest = after;
  }

  const remainder = rest.replace(/^\s+/, "");
  // The whole answer was headlines: keep the original rather than render
  // nothing (same never-empty rule as stripToolNarration).
  if (titles.length > 0 && !remainder) return { titles: [], text };
  return { titles, text: titles.length > 0 ? remainder : text };
}

/**
 * The fold: reasoning-part headlines plus the peeled leading headlines of
 * the answer text, and the text that remains for the reply itself.
 *
 * @param parts       the settled message's parts (reasoning parts, if any)
 * @param text        the reply text, already cleaned of hidden directives
 * @param hasActivity the turn renders a process record (the receipt the
 *                    titles fold into). Without one the text is untouched.
 */
export function foldReasoningTitles({
  parts,
  text,
  hasActivity,
}: {
  parts: readonly unknown[];
  text: string;
  hasActivity: boolean;
}): ReasoningTitleFold {
  const partTitles = parts.flatMap((rawPart) => {
    const parsed = reasoningPartSchema.safeParse(rawPart);
    if (!parsed.success || parsed.data.type !== "reasoning") return [];

    const title = titleOfReasoningPart(parsed.data);
    return title ? [title] : [];
  });

  if (!hasActivity) return { titles: partTitles, text };

  const peeled = peelLeadingTitles(text);
  return { titles: [...partTitles, ...peeled.titles], text: peeled.text };
}

/**
 * The text-only view of the fold, for renderers that draw prose from a
 * pre-split segment (the block path's first prose segment) while the titles
 * themselves are accounted for once at the message level.
 */
export function stripReasoningTitles({
  text,
  hasActivity,
}: {
  text: string;
  hasActivity: boolean;
}): string {
  if (!hasActivity) return text;
  return peelLeadingTitles(text).text;
}
