/**
 * A line Langy wrote is shown once over the parts of one turn: reply text
 * repeating a `say` line loses that line, and a `say` voicing a question
 * card's own question is dropped. @see specs/langy/langy-reply-quality.feature
 */

/** Text as it is compared: one line, single spaces, no ends. */
function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface PartLike {
  type?: unknown;
  toolName?: unknown;
  text?: unknown;
  input?: unknown;
  state?: unknown;
}

/** Is this part a call of the named tool, under either part shape? */
function isToolPart(part: unknown, name: string): boolean {
  const p = part as PartLike;
  if (p?.type === `tool-${name}`) return true;
  return p?.type === "dynamic-tool" && p.toolName === name;
}

/** The words a `say` part carries, empty when it carries none. */
export function saidTextOf(part: unknown): string {
  if (!isToolPart(part, "say")) return "";
  const input = (part as PartLike).input as { text?: unknown } | undefined;
  return typeof input?.text === "string" ? input.text : "";
}

/** The questions a `question` part asks, as their text. */
export function questionTextsOf(part: unknown): string[] {
  if (!isToolPart(part, "question")) return [];
  const input = (part as PartLike).input as { questions?: { question?: unknown }[] } | undefined;
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  return questions
    .map((question) => question?.question)
    .filter((question): question is string => typeof question === "string");
}

/** Every line said with `say` across these parts, ready to compare. */
function saidLines(parts: readonly unknown[]): Set<string> {
  const lines = new Set<string>();
  for (const part of parts) {
    const said = normalized(saidTextOf(part));
    if (said !== "") lines.add(said);
  }
  return lines;
}

/** Every question a card in these parts asks, ready to compare. */
function questionLines(parts: readonly unknown[]): Set<string> {
  const lines = new Set<string>();
  for (const part of parts) {
    for (const question of questionTextsOf(part)) {
      const line = normalized(question);
      if (line !== "") lines.add(line);
    }
  }
  return lines;
}

/**
 * The reply text with its repeats of already-said lines removed. A paragraph
 * that only repeats is gone; a paragraph that adds a word stays as it is, so
 * the model can still write something new at the end of a turn.
 */
export function textWithoutSaidLines(text: string, said: ReadonlySet<string>): string {
  if (said.size === 0 || text === "") return text;
  const kept = text.split("\n").filter((line) => line.trim() === "" || !said.has(normalized(line)));
  const joined = kept.join("\n");
  return joined.trim() === "" ? "" : joined;
}

/**
 * The turn's parts with every line shown once. Parts keep their order and
 * their identity: nothing is reordered, nothing is merged, and a text part
 * emptied by the rule stays in place as an empty text part.
 */
export function partsShownOnce<T>(parts: readonly T[]): T[] {
  const said = saidLines(parts);
  const asked = questionLines(parts);
  return parts
    .filter((part) => !voicesAQuestionCard(part, asked))
    .map((part) => textPartShownOnce(part, said));
}

/** Does this `say` only voice a question a card in the same turn asks? */
function voicesAQuestionCard(part: unknown, asked: ReadonlySet<string>): boolean {
  if (asked.size === 0) return false;
  const said = normalized(saidTextOf(part));
  return said !== "" && asked.has(said);
}

/** This part, with its text emptied of lines already said. */
function textPartShownOnce<T>(part: T, said: ReadonlySet<string>): T {
  const p = part as PartLike;
  if (p?.type !== "text" || typeof p.text !== "string") return part;
  const text = textWithoutSaidLines(p.text, said);
  return text === p.text ? part : ({ ...p, text } as T);
}
