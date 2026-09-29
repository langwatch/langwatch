// Which bare `and` / `or` / `not` the search bar uppercases into an operator as
// the separator after it is typed. A word after a bare word is part of a
// sentence, and stays a word. @see specs/traces-v2/search.feature

const OPERATOR_TRIGGER = /(?:^|[\s(])(and|or|not)$/;
const SEPARATOR_REGEX = /[\s()]/;
const OPERATOR_WORDS: ReadonlySet<string> = new Set(["AND", "OR", "NOT"]);

function isInsideQuoted(text: string, pos: number): boolean {
  let count = 0;
  for (let i = 0; i < pos; i++) {
    if (text[i] === '"') count++;
  }
  return count % 2 === 1;
}

function isInsideBrackets(text: string, pos: number): boolean {
  let depth = 0;
  for (let i = 0; i < pos; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") depth--;
  }
  return depth > 0;
}

/** Whether the text ends in a term written as filter syntax rather than a word of a sentence. */
function endsWithExplicitTerm(trimmed: string): boolean {
  const token = trimmed.split(/\s+/).at(-1) ?? "";
  if (token.includes(":")) return true;
  if (/["\])]$/.test(token)) return true;
  // A closing single quote, told apart from a trailing possessive (members').
  if (/(?:^|[\s:(])'[^']*'$/.test(trimmed)) return true;
  return token.length > 1 && token.startsWith("-");
}

/**
 * Whether `word` at this spot joins filter terms: `not` opens a clause at the
 * start, after `(` or after an operator; any of the three may follow an
 * explicit term. After a bare word it is a word of the sentence.
 */
function readsAsOperator({ word, before }: { word: string; before: string }): boolean {
  const trimmed = before.trimEnd();
  if (!trimmed || trimmed.endsWith("(")) return word === "not";
  const previous = trimmed.split(/\s+/).at(-1) ?? "";
  if (OPERATOR_WORDS.has(previous)) return word === "not";
  return endsWithExplicitTerm(trimmed);
}

/**
 * The operator the keystroke just closed off, as a text range, or null when
 * the edit was not a single separator typed after an `and` / `or` / `not`
 * that joins filter terms.
 */
export function operatorEdit({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}): { word: string; from: number; to: number } | null {
  if (newText.length !== oldText.length + 1) return null;
  // `isInsideQuoted`/`isInsideBrackets` are O(n); skip pathological docs.
  if (newText.length > 5_000) return null;

  let diffAt = 0;
  while (diffAt < oldText.length && oldText[diffAt] === newText[diffAt]) {
    diffAt += 1;
  }
  const inserted = newText[diffAt];
  if (!inserted || !SEPARATOR_REGEX.test(inserted)) return null;

  const match = newText.slice(0, diffAt).match(OPERATOR_TRIGGER);
  if (!match) return null;
  const word = match[1] ?? "";
  const wordStart = diffAt - word.length;
  if (isInsideQuoted(newText, wordStart) || isInsideBrackets(newText, wordStart)) return null;
  if (!readsAsOperator({ word, before: newText.slice(0, wordStart) })) return null;

  return { word, from: wordStart, to: diffAt };
}
