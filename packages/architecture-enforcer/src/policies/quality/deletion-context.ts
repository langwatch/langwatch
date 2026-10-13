/**
 * Whether a deleted spelling sits in a sentence about its deletion. A Markdown page is cut into
 * units (a sentence, a table row, a code-fence line); a unit is a deletion note when it, or its
 * frame (section heading, table header, the lead-in of its list or code fence), says so.
 */

/** Words that make a sentence about a deletion rather than a use of the spelling. */
const DELETION_WORDS =
  /\b(?:delet(?:e|es|ed|ing)|remov(?:e|es|ed|ing)|renam(?:e|es|ed|ing)|retir(?:e|es|ed|ing)|supersed(?:e|es|ed|ing)|replac(?:e|es|ed|ing)|never|banned|forbidden|no longer|instead of|(?:is|are) gone|refus(?:e|es|ed)|wrong|there is no|(?:do not|don't) (?:write|use|add|import|copy))\b|\bno\s+(?:an?\s+)?`|§15/i;
const DELETION_HEADING = /\b(?:deleted|removed|retired|renames?)\b/i;
const HEADING = /^(#{1,6})\s/;
const FENCE = /^\s*(?:```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const SENTENCE_END = /[.!?](?=\s)/g;

export type ContextUnit = { start: number; end: number; deletion: boolean };

export function isDeletionNote(text: string): boolean {
  return DELETION_WORDS.test(text);
}

type Line = { text: string; start: number; end: number };

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;

  for (const content of text.split("\n")) {
    lines.push({ text: content, start, end: start + content.length });
    start += content.length + 1;
  }

  return lines;
}

/** A prose block cut into sentences, each a deletion note on its own words or its frame's. */
function sentenceUnits({
  source,
  start,
  end,
  framed,
}: {
  source: string;
  start: number;
  end: number;
  framed: boolean;
}): ContextUnit[] {
  const block = source.slice(start, end);
  const units: ContextUnit[] = [];
  let from = 0;

  for (const match of block.matchAll(SENTENCE_END)) {
    const to = match.index + 1;
    units.push({
      start: start + from,
      end: start + to,
      deletion: framed || isDeletionNote(block.slice(from, to)),
    });
    from = to;
  }
  units.push({ start: start + from, end, deletion: framed || isDeletionNote(block.slice(from)) });

  return units;
}

type Walk = {
  units: ContextUnit[];
  headings: boolean[];
  /** The last prose block's closing sentence: the lead-in of a following list or code fence. */
  leadIn: string;
  listFramed: boolean;
};

function inDeletedSection(walk: Walk): boolean {
  return walk.headings.some(Boolean);
}

function enterHeading({ walk, line, level }: { walk: Walk; line: Line; level: number }): void {
  walk.headings = walk.headings.slice(0, level - 1);
  while (walk.headings.length < level - 1) walk.headings.push(false);
  walk.headings.push(DELETION_HEADING.test(line.text));
  walk.units.push({ start: line.start, end: line.end, deletion: inDeletedSection(walk) });
  walk.leadIn = "";
  walk.listFramed = false;
}

/** Cuts a Markdown page into context units, in order and covering every line. */
export function markdownContextUnits(source: string): ContextUnit[] {
  const lines = linesOf(source);
  const walk: Walk = { units: [], headings: [], leadIn: "", listFramed: false };
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const heading = HEADING.exec(line.text);

    if (heading) {
      enterHeading({ walk, line, level: heading[1]!.length });
      index += 1;
    } else if (FENCE.test(line.text)) {
      index = fenceUnits({ walk, lines, index });
    } else if (TABLE_ROW.test(line.text)) {
      index = tableUnits({ walk, lines, index });
    } else if (line.text.trim() === "") {
      walk.units.push({ start: line.start, end: line.end, deletion: false });
      index += 1;
    } else {
      index = proseUnits({ walk, lines, index, source });
    }
  }

  return walk.units;
}

function fenceUnits({ walk, lines, index }: { walk: Walk; lines: Line[]; index: number }): number {
  const framed = inDeletedSection(walk) || isDeletionNote(walk.leadIn);
  const push = (line: Line): void => {
    walk.units.push({
      start: line.start,
      end: line.end,
      deletion: framed || isDeletionNote(line.text),
    });
  };

  push(lines[index]!);
  let at = index + 1;
  while (at < lines.length) {
    const line = lines[at]!;
    push(line);
    at += 1;
    if (FENCE.test(line.text)) break;
  }

  return at;
}

function tableUnits({ walk, lines, index }: { walk: Walk; lines: Line[]; index: number }): number {
  const header = lines[index]!.text;
  const framed = inDeletedSection(walk) || isDeletionNote(walk.leadIn);
  let at = index;

  while (at < lines.length && TABLE_ROW.test(lines[at]!.text)) {
    const line = lines[at]!;
    walk.units.push({
      start: line.start,
      end: line.end,
      deletion: framed || isDeletionNote(`${header} ${line.text}`),
    });
    at += 1;
  }
  walk.leadIn = "";

  return at;
}

/** A paragraph or a list item with its continuation lines. */
function proseUnits({
  walk,
  lines,
  index,
  source,
}: {
  walk: Walk;
  lines: Line[];
  index: number;
  source: string;
}): number {
  const isItem = LIST_ITEM.test(lines[index]!.text);
  if (!isItem) walk.listFramed = false;
  if (isItem && walk.leadIn !== "") walk.listFramed = isDeletionNote(walk.leadIn);

  let at = index + 1;
  while (at < lines.length && continuesBlock(lines[at]!.text)) at += 1;

  const start = lines[index]!.start;
  const end = lines[at - 1]!.end;
  const framed = inDeletedSection(walk) || (isItem && walk.listFramed);
  const units = sentenceUnits({ source, start, end, framed });
  walk.units.push(...units);

  const last = units.at(-1)!;
  walk.leadIn = isItem ? "" : source.slice(last.start, last.end);

  return at;
}

function continuesBlock(text: string): boolean {
  return (
    text.trim() !== "" &&
    !HEADING.test(text) &&
    !FENCE.test(text) &&
    !TABLE_ROW.test(text) &&
    !LIST_ITEM.test(text)
  );
}

/** The unit holding `offset`, by binary search over units in document order. */
export function unitAt({
  units,
  offset,
}: {
  units: readonly ContextUnit[];
  offset: number;
}): ContextUnit | undefined {
  let low = 0;
  let high = units.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const unit = units[middle]!;
    if (offset < unit.start) high = middle - 1;
    else if (offset > unit.end) low = middle + 1;
    else return unit;
  }

  return undefined;
}
