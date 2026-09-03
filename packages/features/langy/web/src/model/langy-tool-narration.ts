/**
 * Removes leading process narration when durable activity already renders it.
 * It never decides which cards exist or changes text without an activity card.
 * Only leading narration is eligible, and the original survives if stripping
 * would empty the answer. False matches therefore affect redundant prose, not
 * application state or evidence of work.
 */

/**
 * Narration and the answer often share one paragraph, so matching must work
 * sentence by sentence rather than treating a whole line as one candidate.
 */

/** Announcing an action, rather than reporting one. */
const GERUND_OPENER =
  /^(?:running|searching|fetching|querying|checking|extracting|analysing|analyzing|looking|gathering|pulling|reading|counting|loading|listing|using|invoking|calling|executing)\b/i;

/**
 * Words that mark a gerund opener as being about OUR work.
 *
 * The guard that keeps "Running total is $45." — a genuine answer — out of the
 * shredder while "Running the trace search…" goes in. A bare gerund is not
 * enough evidence on its own.
 */
const WORK_NOUN =
  /\b(?:trace|traces|span|spans|dataset|datasets|analytic|analytics|evaluator|evaluators|monitor|scenario|prompt|dashboard|workflow|skill|recipe|tool|command|cli|search|query|workflow)\b/i;

/** Stating an intention instead of a result. */
const INTENTION_OPENER =
  /^(?:(?:i'?ll|i will|i'?m going to|i am going to|let me|let's)\b|(?:first|next|now|then)[,]?\s+(?:i'?ll|i will|i'?m going to|let me)\b)/i;

/** A bare invocation echoed back: "`langwatch trace search --format json`". */
const ECHOED_COMMAND = /^`\s*langwatch\b[^`]*`\.?$/i;

function isNarration(sentence: string): boolean {
  const text = sentence.trim();
  if (!text) return false;
  if (INTENTION_OPENER.test(text)) return true;
  if (ECHOED_COMMAND.test(text)) return true;
  if (!GERUND_OPENER.test(text)) return false;
  // A gerund opener counts only with corroboration: it names the work, or it
  // trails off (a sentence that ends in "…" was never a finding).
  return WORK_NOUN.test(text) || /(?:…|\.\.\.)\s*$/.test(text);
}

/** Split a block into sentences, keeping their terminators. */
function sentencesOf(block: string): string[] {
  return block.split(/(?<=[.!?…])\s+/).filter((part) => part.trim().length > 0);
}

/**
 * Drop leading narration lines from an assistant reply.
 *
 * @param text        the reply, already cleaned of hidden directives
 * @param hasActivity the turn rendered tool activity (a card is on screen, so
 *                    narration about it is duplication). With no activity the
 *                    text is returned untouched.
 */
export function stripToolNarration({
  text,
  hasActivity,
}: {
  text: string;
  hasActivity: boolean;
}): string {
  if (!hasActivity || !text.trim()) return text;

  // Walk the reply from the top, line by line and — within each line — sentence
  // by sentence, because narration arrives in every combination: its own line,
  // two sentences sharing a line with the answer, or several blocks stacked
  // with blank lines between. Stop at the first thing that is not narration;
  // anything after that point is the answer and is never touched.
  const lines = text.split("\n");
  let lineIndex = 0;
  let headRemainder: string | null = null;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex]!;
    if (!line.trim()) {
      lineIndex += 1;
      continue;
    }
    const sentences = sentencesOf(line);
    let cursor = 0;
    while (cursor < sentences.length && isNarration(sentences[cursor]!)) {
      cursor += 1;
    }
    if (cursor === 0) break;
    if (cursor < sentences.length) {
      // Narration and answer shared this line — keep the tail of it and stop.
      headRemainder = sentences.slice(cursor).join(" ").trim();
      lineIndex += 1;
      break;
    }
    lineIndex += 1;
  }

  const kept = [...(headRemainder ? [headRemainder] : []), ...lines.slice(lineIndex)]
    .join("\n")
    .replace(/^\n+/, "")
    .trim();

  // Nothing was narration, or the whole reply was. Either way keep the original:
  // an empty bubble tells the user nothing at all, which is strictly worse than
  // telling them twice.
  return kept ? kept : text;
}
