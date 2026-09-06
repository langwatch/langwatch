/**
 * Strip the assistant's process narration when a card already said it.
 *
 * ── THE DUPLICATION ────────────────────────────────────────────────────────
 *
 * A turn that uses a skill renders an activity card built from the skill's own
 * catalogue entry — "Using the Agent performance skill", plus its SKILL.md
 * description. The model then, routinely, opens its reply with the same
 * sentence in prose:
 *
 *     [card]  Used the Agent performance skill
 *             Deep-dive diagnosis of how your AI agent behaves in production…
 *     [prose] Using the agent-performance skill to search recent traces.
 *             No traces in last 24h.
 *
 * The user reads the same fact three times before reaching the one line they
 * asked for. The answer should be the card, then "No traces in last 24h."
 *
 * `AGENTS.md` rule 12 already forbids exactly this — it even lists "Using the
 * analytics skill to..." among its banned openers — so the prose is a
 * prompt-adherence failure, not a deliberate design. But a rule the model has
 * already been given and already ignored does not get more effective by being
 * restated, and the cost of the failure lands on every turn that uses a skill.
 * So the panel drops the line.
 *
 * ── WHY THIS IS NOT THE PROSE-SNIFFING WE DELETED ──────────────────────────
 *
 * MessageContent used to derive UI STATE from the model's text: a
 * `[langy:connect-github]` sentinel drove the connect card, and any GitHub PR
 * URL in the reply drew a PR card. Both are gone, and the comments explaining
 * why are worth re-reading — we had asked an LLM to be a reliable state machine
 * in text and then parsed the text to drive behaviour, so the model could forget
 * the magic words, paraphrase them, or say them on a turn that never touched
 * GitHub.
 *
 * This is the opposite direction and a different risk class. Nothing here
 * decides what to render, fetch, or believe; the cards are already built from
 * tool parts and are unaffected. This only elides a leading sentence from text
 * we were going to display anyway. A false positive drops one redundant line; a
 * false negative shows one redundant line. Neither can produce a card for work
 * that did not happen, which was the whole objection.
 *
 * ── CONSERVATIVE BY CONSTRUCTION ───────────────────────────────────────────
 *
 *   - LEADING lines only. Narration is an opener; a sentence mid-answer is
 *     doing something else and is left alone.
 *   - Only when the turn HAS activity to duplicate. With no card on screen the
 *     narration may be the entire answer, and a panel that silently eats it is
 *     far worse than one that repeats itself.
 *   - Never empties the message. If stripping would leave nothing, the original
 *     is returned untouched — better a redundant line than a blank reply.
 */

/**
 * SENTENCES, not lines.
 *
 * The first cut of this matched whole LINES, and missed every real case,
 * because the model does not put its narration on a line of its own — it opens
 * with two narrating sentences and then answers, all in one paragraph:
 *
 *   "Running the trace search and extracting latencies for the most recent 10
 *    traces. I'll return a concise summary.\n\n10 traces. …"
 *
 *   "Searching traces via the agent-performance skill for traces dated in 2025
 *    (assume full-year 2025). I'll load the skill and run its workflow.\n\nNo
 *    traces in 2025."
 *
 * Both lines fail a whole-line match, so both survived. Working sentence by
 * sentence is what actually catches them.
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

  const kept = [
    ...(headRemainder ? [headRemainder] : []),
    ...lines.slice(lineIndex),
  ]
    .join("\n")
    .replace(/^\n+/, "")
    .trim();

  // Nothing was narration, or the whole reply was. Either way keep the original:
  // an empty bubble tells the user nothing at all, which is strictly worse than
  // telling them twice.
  return kept ? kept : text;
}
