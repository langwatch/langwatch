import {
  PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS,
  PII_REDACTION_MODEL_MAX_SPLIT_CHARACTERS,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { formatPiiMarker } from "@langwatch/redaction";

import {
  clearingOfAnswer,
  codepointToCodeUnitConverter,
  mergeOverlapping,
  NAME_AND_PLACE_ENTITIES,
  type PresidioFinding,
  presidioFindingsSchema,
} from "./pii-analysis.rules.ts";
import { batchCharactersOf, MODEL_CALL_RULES } from "./pii-redaction-model.rules.ts";

/** Most characters one split call carries (ADR-207 decision 3). */
export const PII_REDACTION_MODEL_PIECE_CHARACTERS = 4_000;

/** Characters a piece repeats from the one before it, so a name across a cut is seen whole. */
const PII_REDACTION_MODEL_PIECE_OVERLAP = 200;

/** A call our own abort rejects holds its slot this long from its start: the model's 55 s + 5 s. */
export const PII_REDACTION_MODEL_ABORTED_SLOT_HOLD_MS = 60_000;

/** A warm call's time per character: 10 s for 4,000, from 4.4 s at 2,000 and 63 s at 20,000. */
const PII_REDACTION_MODEL_ESTIMATED_MS_PER_CHARACTER = 2.5;

/** A slice of one text, `[start, end)` in UTF-16; `whole` when it is the entire text. */
type SplitPiece = Readonly<{ text: number; start: number; end: number; whole: boolean }>;

/** One split call to the model: one or more pieces, at most 4,000 characters in all. */
export type SplitCall = Readonly<{ pieces: readonly SplitPiece[] }>;

/** How a span batch reaches the model: one call as today, split, or Presidio for its length. */
type SpanPlan =
  | Readonly<{ kind: "single" }>
  | Readonly<{ kind: "split"; calls: readonly SplitCall[] }>
  | Readonly<{ kind: "too_long" }>;

/** The model's answer for one piece, as its Presidio route returns it. */
export type PieceAnswer = Readonly<{ piece: SplitPiece; findings: unknown; anonymized: unknown }>;

/** Python's `str.isspace` set, which the model trims each entry with (saas `domain/pyunicode`). */
const PYTHON_WHITESPACE: readonly (readonly [number, number])[] = [
  [0x09, 0x0d],
  [0x1c, 0x20],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

function isPythonSpace(char: string | undefined): boolean {
  const code = char?.codePointAt(0);
  return code !== undefined && PYTHON_WHITESPACE.some(([low, high]) => code >= low && code <= high);
}

/**
 * Whether a text's answer in a batch of `batchCharacters` is the one it gets sent on its own: one
 * call, a whole text packed into a split call, or a text long enough to be cut alone (cuts depend
 * on the text only). A text cut only because its batch was long is answered differently alone.
 */
export function isAnsweredAsAlone({
  text,
  batchCharacters,
}: {
  text: string;
  batchCharacters: number;
}): boolean {
  return (
    batchCharacters <= PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS ||
    text.length <= PII_REDACTION_MODEL_PIECE_CHARACTERS ||
    text.length > PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS
  );
}

/** The plan for a span batch; `splitting` says whether this batch may split (decisions 8, 9). */
export function planSpan({
  texts,
  splitting,
}: {
  texts: readonly string[];
  splitting: boolean;
}): SpanPlan {
  const characters = batchCharactersOf(texts);
  if (characters <= PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS) return { kind: "single" };
  if (!splitting || characters > PII_REDACTION_MODEL_MAX_SPLIT_CHARACTERS) {
    return { kind: "too_long" };
  }
  const pieces = texts.flatMap((text, index) =>
    text.length <= PII_REDACTION_MODEL_PIECE_CHARACTERS
      ? [{ text: index, start: 0, end: text.length, whole: true }]
      : cutText({ text, index }),
  );
  return { kind: "split", calls: packCalls(pieces) };
}

/**
 * A long text cut at whitespace; the next piece starts at the word holding the character 200
 * before the cut, or at that character inside one long word. Every cut overlaps by 200 or more,
 * and no piece starts or ends on a character the model trims (ADR-207 decision 3).
 */
function cutText({ text, index }: { text: string; index: number }): SplitPiece[] {
  const pieces: SplitPiece[] = [];
  let start = skipSpaces({ text, from: 0 });
  let end = text.length;
  while (end > start && isPythonSpace(text[end - 1])) end--;
  const last = end;
  while (start < last) {
    if (last - start <= PII_REDACTION_MODEL_PIECE_CHARACTERS) {
      pieces.push({ text: index, start, end: last, whole: false });
      break;
    }
    end = cutBefore({ text, start });
    pieces.push({ text: index, start, end, whole: false });
    start = nextStart({ text, start, end });
  }
  return pieces;
}

/**
 * Where the piece after [start, end) starts, always past `start`: the word holding (or ending
 * before) the character 200 before `end`, else that character inside a long word. Within 1,000
 * of `end` only: a value never spans 800 spaces, so after such a run the next starts past it.
 */
function nextStart({ text, start, end }: { text: string; start: number; end: number }): number {
  const overlapAt = end - PII_REDACTION_MODEL_PIECE_OVERLAP;
  const floor = Math.max(start + 1, end - PII_REDACTION_MODEL_PIECE_CHARACTERS / 4);
  if (overlapAt < floor) return skipSpaces({ text, from: end });
  let at = overlapAt;
  while (at > floor && isPythonSpace(text[at])) at--;
  if (isPythonSpace(text[at])) return skipSpaces({ text, from: overlapAt });
  let word = at;
  while (word > floor && !isPythonSpace(text[word - 1])) word--;
  if (isPythonSpace(text[word - 1])) return word;
  const code = text.charCodeAt(at);
  if (code < 0xdc00 || code > 0xdfff) return at;
  return at - 1 > start ? at - 1 : at + 1;
}

/**
 * Where a piece from `start` ends: before the last whitespace run within 4,000, unless that
 * leaves under 2,000; then a hard cut at 4,000, inside a long word, which the overlap covers.
 */
function cutBefore({ text, start }: { text: string; start: number }): number {
  const limit = start + PII_REDACTION_MODEL_PIECE_CHARACTERS;
  let end = limit;
  while (end > start && !isPythonSpace(text[end])) end--;
  while (end > start && isPythonSpace(text[end - 1])) end--;
  if (end - start >= PII_REDACTION_MODEL_PIECE_CHARACTERS / 2) return end;
  end = offLowSurrogate({ text, at: limit });
  while (end > start && isPythonSpace(text[end - 1])) end--;
  return end;
}

/** `at`, or one back when it would split a surrogate pair, so no piece holds half a character. */
function offLowSurrogate({ text, at }: { text: string; at: number }): number {
  const code = text.charCodeAt(at);
  return code >= 0xdc00 && code <= 0xdfff ? at - 1 : at;
}

function skipSpaces({ text, from }: { text: string; from: number }): number {
  let at = from;
  while (at < text.length && isPythonSpace(text[at])) at++;
  return at;
}

/** A cut piece is a call of its own; whole texts share calls, first fit, 4,000 at most. */
function packCalls(pieces: readonly SplitPiece[]): SplitCall[] {
  const calls: SplitPiece[][] = pieces.filter((piece) => !piece.whole).map((piece) => [piece]);
  const wholes: { pieces: SplitPiece[]; size: number }[] = [];
  for (const piece of pieces.filter((candidate) => candidate.whole)) {
    const length = piece.end - piece.start;
    const room = wholes.find((call) => call.size + length <= PII_REDACTION_MODEL_PIECE_CHARACTERS);
    if (room) {
      room.pieces.push(piece);
      room.size += length;
    } else {
      wholes.push({ pieces: [piece], size: length });
    }
  }
  return [...calls, ...wholes.map((call) => call.pieces)].map((call) => ({ pieces: call }));
}

/** Whether a split span's calls can finish inside the span budget on `slots` slots, warm. */
export function fitsSpanBudget({
  calls,
  slots,
}: {
  calls: readonly SplitCall[];
  slots: number;
}): boolean {
  if (slots < 1) return false;
  const busyUntil = Array.from({ length: slots }, () => 0);
  for (const call of calls) {
    const characters = call.pieces.reduce((total, piece) => total + piece.end - piece.start, 0);
    const soonest = busyUntil.indexOf(Math.min(...busyUntil));
    busyUntil[soonest] =
      (busyUntil[soonest] ?? 0) + characters * PII_REDACTION_MODEL_ESTIMATED_MS_PER_CHARACTER;
  }
  return Math.max(...busyUntil) <= MODEL_CALL_RULES.split.budgetMs;
}

/** The text one piece sends: its slice of its batch text. */
export function pieceTextOf({
  texts,
  piece,
}: {
  texts: readonly string[];
  piece: SplitPiece;
}): string {
  return (texts[piece.text] ?? "").slice(piece.start, piece.end);
}

/**
 * Whether the model's offsets for this cut piece index its raw characters (decision 5): no
 * backslash it could unfold, as it only does for a piece that reads as JSON, nothing at either
 * end it would trim.
 */
export function isPlaceablePiece(piece: string): boolean {
  return (
    piece.length > 0 &&
    !(piece.includes("\\") && mayReadAsJson(piece)) &&
    !isPythonSpace(piece[0]) &&
    !isPythonSpace(piece.at(-1))
  );
}

/**
 * Whether the model could take the piece as JSON, its NaN and Infinity included. Errs towards
 * yes: a token inside a string is replaced too, and any failure but a syntax error counts.
 */
function mayReadAsJson(piece: string): boolean {
  try {
    JSON.parse(piece.replace(/-?Infinity|NaN/g, "null"));
    return true;
  } catch (error) {
    return !(error instanceof SyntaxError);
  }
}

/** Each text cleared from every piece's answer, or `unplaceable` when any piece cannot be. */
export function clearSplitSpan({
  texts,
  answers,
  spareNamesAndPlaces,
}: {
  texts: readonly string[];
  answers: readonly PieceAnswer[];
  spareNamesAndPlaces?: readonly boolean[] | undefined;
}): (string | null)[] | "unplaceable" {
  const found = texts.map((): PresidioFinding[] => []);
  const whole = new Map<number, PieceAnswer>();
  for (const answer of answers) {
    const { piece } = answer;
    if (piece.whole) {
      whole.set(piece.text, answer);
      continue;
    }
    const placed = placedFindings({ text: texts[piece.text] ?? "", answer });
    if (placed === "unplaceable") return placed;
    found[piece.text]?.push(...placed);
  }
  if (lacksMaskedText({ texts, whole })) return "unplaceable";
  return texts.map((text, index) => {
    const spared = spareNamesAndPlaces?.[index] ?? false;
    const wholeAnswer = whole.get(index);
    if (wholeAnswer) {
      const clearing = clearingOfAnswer({
        input: text,
        rawResponse: { results: wholeAnswer.findings, anonymized: wholeAnswer.anonymized },
        spareNamesAndPlaces: spared,
      });
      return clearing.kind === "redacted" ? clearing.text : null;
    }
    const kept = (found[index] ?? []).filter(
      (finding) => !spared || !NAME_AND_PLACE_ENTITIES.has(finding.entity_type),
    );
    return kept.length === 0 ? null : masked({ text, findings: kept, marker: formatPiiMarker });
  });
}

/** The model masks every text it processes; only a blank one comes back without it, or empty. */
function lacksMaskedText({
  texts,
  whole,
}: {
  texts: readonly string[];
  whole: ReadonlyMap<number, PieceAnswer>;
}): boolean {
  return [...whole].some(
    ([index, answer]) =>
      (typeof answer.anonymized !== "string" || answer.anonymized === "") &&
      !Array.from(texts[index] ?? "").every((char) => isPythonSpace(char)),
  );
}

/** How many masked ranges a cleared split span holds, for its usage line. */
export function splitFindingsCount({
  texts,
  answers,
}: {
  texts: readonly string[];
  answers: readonly PieceAnswer[];
}): number {
  const found = texts.map((): PresidioFinding[] => []);
  for (const answer of answers) {
    const parsed = presidioFindingsSchema.safeParse(answer.findings);
    if (!parsed.success) continue;
    const { piece } = answer;
    // A cut piece's code points become the text's code units, as when it was masked.
    const toCodeUnit = piece.whole
      ? (offset: number) => offset
      : codepointToCodeUnitConverter((texts[piece.text] ?? "").slice(piece.start, piece.end));
    const shift = piece.whole ? 0 : piece.start;
    found[piece.text]?.push(
      ...parsed.data.map((finding) => ({
        ...finding,
        start: toCodeUnit(finding.start) + shift,
        end: toCodeUnit(finding.end) + shift,
      })),
    );
  }
  return found.reduce((total, findings) => total + mergeOverlapping(findings).length, 0);
}

/**
 * One cut piece's findings in the full text's UTF-16 offsets, once the piece passes both guards:
 * placeable, and its findings rebuild the model's own masked piece exactly.
 */
function placedFindings({
  text,
  answer,
}: {
  text: string;
  answer: PieceAnswer;
}): PresidioFinding[] | "unplaceable" {
  const pieceText = text.slice(answer.piece.start, answer.piece.end);
  const parsed = presidioFindingsSchema.safeParse(answer.findings);
  if (!isPlaceablePiece(pieceText) || !parsed.success) return "unplaceable";
  // Checked in code points first: the converter clamps an offset past the piece's end.
  const codePoints = Array.from(pieceText).length;
  if (parsed.data.some((f) => f.start < 0 || f.end > codePoints || f.start >= f.end)) {
    return "unplaceable";
  }
  const toCodeUnit = codepointToCodeUnitConverter(pieceText);
  const findings = parsed.data.map((finding) => ({
    ...finding,
    start: toCodeUnit(finding.start),
    end: toCodeUnit(finding.end),
  }));
  const rebuilt = masked({ text: pieceText, findings, marker: (entity) => `<${entity}>` });
  if (rebuilt !== answer.anonymized) return "unplaceable";
  return findings.map((finding) => ({
    ...finding,
    start: finding.start + answer.piece.start,
    end: finding.end + answer.piece.start,
  }));
}

function masked({
  text,
  findings,
  marker,
}: {
  text: string;
  findings: readonly PresidioFinding[];
  marker: (entity: string) => string;
}): string {
  let out = "";
  let cursor = 0;
  for (const { entity_type, start, end } of mergeOverlapping(findings)) {
    out += text.substring(cursor, start) + marker(entity_type);
    cursor = end;
  }
  return out + text.substring(cursor);
}
