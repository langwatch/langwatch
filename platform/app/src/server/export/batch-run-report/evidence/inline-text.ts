/**
 * Flattening caller-supplied strings before they reach a model.
 *
 * The evidence block is a line-oriented document that both model passes read as
 * fact, and most of the values in it come from the customer's own suite: suite
 * names, scenario names, criterion wording, judge reasoning, error strings and
 * whole conversation turns. A value that can open a line of its own can write a
 * fact the block never stated, and the forged fact can name a run id that
 * genuinely exists in this batch. It resolves, the checker confirms it from the
 * same forged line, and the sentence ships at the checked tier.
 *
 * So every one of those values passes through here first, and the invariant is
 * small enough to test: nothing a caller supplies reaches column 0, and nothing
 * a caller supplies reads as the block's own structure.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/**
 * Everything that is not printable text, tabs excepted.
 *
 * One rule rather than a list of the line breaks anyone thought of. Carriage
 * return and line feed are the obvious ones, but vertical tab, form feed,
 * U+0085, U+2028 and U+2029 are all treated as line terminators somewhere in
 * the stack, and one of them surviving is enough to put caller text at column
 * 0, where the block's own fact lines live. The rest of the control range
 * cannot open a line, but it renders as nothing, which hides the remainder of
 * a value from a human comparing the block against a transcript. Both go.
 */
const NON_PRINTING = /(?:(?!\t)[\p{Cc}\p{Zl}\p{Zp}])+/gu;

/**
 * A marker that would read as the block's own structure rather than as a value:
 * a section heading, a record separator, a quote, a rule.
 *
 * Matched only at the very start of a value, and only where it is followed by
 * whitespace or ends the value, so a sentence about issue #42 or an arrow
 * written as `->` is left alone. The words after the marker are kept; only its
 * ability to open a section is taken away.
 */
const LEADING_STRUCTURE = /^\s*(?:#{1,6}|-{2,}|={2,}|\*{2,}|>+)(?=\s|$)\s*/;

/**
 * The visible stand-in for a line break.
 *
 * Deliberately not a plain space: a reader comparing the block against a
 * transcript should be able to see where the line breaks were.
 */
const LINE_BREAK_MARKER = " ⏎ ";

/** A user-authored string flattened onto one line, with its structure disarmed. */
export function inline(value: string): string {
  return flatten({ value, lineBreakAs: LINE_BREAK_MARKER });
}

/**
 * The same string as a quoted value.
 *
 * Used where the block wants the value to read unmistakably as data: a scenario
 * name, a criterion's wording, the suite's own name. Quoting is not the safety
 * property, the flattening is, but a quoted value additionally cannot be
 * mistaken for one of the block's bare `key: value` lines. The line-break
 * marker earns nothing inside quotes, where the value already has visible
 * bounds, so quoted values collapse to a space instead.
 */
export function quoted(value: string): string {
  return `"${flatten({ value, lineBreakAs: " " })
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

function flatten({
  value,
  lineBreakAs,
}: {
  value: string;
  lineBreakAs: string;
}): string {
  return disarmLeadingStructure(value.replace(NON_PRINTING, lineBreakAs));
}

/**
 * Strips leading markers until none is left, so a value beginning
 * `## --- ## SCENARIOS` cannot survive by hiding one marker behind another.
 */
function disarmLeadingStructure(value: string): string {
  let disarmed = value;
  while (LEADING_STRUCTURE.test(disarmed)) {
    disarmed = disarmed.replace(LEADING_STRUCTURE, "");
  }
  return disarmed;
}
