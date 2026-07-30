/**
 * Fold a settled turn's reasoning-summary titles out of the transcript.
 *
 * ── WHAT THESE LINES ARE ───────────────────────────────────────────────────
 *
 * Reasoning-capable models (codex gpt-5.x via the Responses API) emit short
 * reasoning-summary headlines between tool calls — "Planning task execution
 * strategy", "Summarizing recent trace counts". Reasoning is meant to be a
 * live-edge signal only (the relay never persists it as a message part), but
 * the agent manager's upstream stream carries reasoning deltas on the same
 * `field:"text"` channel as answer tokens, so the headlines leak into the
 * durable answer text as `**Title**` markdown paragraphs. A finished turn
 * then reads as a stack of loose bold lines above the actual reply — and the
 * LAST headline glues straight onto the reply's first word when no tool call
 * ran between them ("…trace countsMostly Langy conversations…").
 *
 * This module is the presentation-side fold: peel the leading headline
 * paragraphs off the settled text and hand them to the completed-actions
 * receipt, where the rest of the turn's process record already collapses.
 * The reply below stays prose only, and the glued headline is severed so the
 * answer starts as its own block.
 *
 * A message may also carry real `reasoning`-typed parts (never rendered as
 * prose). Their headlines feed the same fold, so the receipt accounts for
 * them wherever the titles happen to live.
 *
 * ── CONSERVATIVE BY CONSTRUCTION ───────────────────────────────────────────
 *
 * Same stance as `stripToolNarration`:
 *   - LEADING paragraphs only; bold inside the answer is the model's own
 *     emphasis and is never touched.
 *   - Only when the turn HAS activity — the receipt must exist for the
 *     titles to fold into; with none, the text is returned untouched.
 *   - A headline must LOOK like one: a single short line of at least two
 *     words with no sentence punctuation. "**Note:** do X" and a deliberate
 *     bold opening sentence stay in the answer.
 *   - A glued headline (`**Title**Answer…`) is only trusted after at least
 *     one standalone headline was peeled — one bold run at the start of an
 *     answer is ambiguous, five bold paragraphs then a sixth are not.
 *   - Never empties the answer: if peeling would leave nothing, the
 *     original text is returned untouched.
 */

const MAX_TITLE_CHARS = 80;

/** A single-line bold run at the head of the remaining text. */
const LEADING_BOLD = /^\*\*([^*\n]+)\*\*/;

interface PartLike {
  type?: string;
  text?: string;
}

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
function titleOfReasoningPart(part: PartLike): string | null {
  const firstLine = (part.text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  const bold = LEADING_BOLD.exec(firstLine);
  return (bold ? bold[1]! : firstLine).trim() || null;
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
    if (!bold || !looksLikeReasoningTitle(bold[1]!)) break;
    const after = lead.slice(bold[0].length);
    const standalone = after === "" || after.startsWith("\n");
    const nextBold = LEADING_BOLD.exec(after);
    const gluedToAnotherTitle =
      nextBold !== null && looksLikeReasoningTitle(nextBold[1]!);
    // A lone bold run glued to plain prose is the model's own emphasis
    // ("**Very important** never…") — leave it be.
    if (!standalone && titles.length === 0 && !gluedToAnotherTitle) break;
    titles.push(bold[1]!.trim());
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
    const part = rawPart as PartLike;
    if (part.type !== "reasoning") return [];
    const title = titleOfReasoningPart(part);
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
