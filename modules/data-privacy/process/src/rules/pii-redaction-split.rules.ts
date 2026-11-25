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
import { batchCharactersOf, piiRedactionModelTargetOf } from "./pii-redaction-model.rules.ts";

/** Most characters one split call carries (ADR-207 decision 3). */
export const PII_REDACTION_MODEL_PIECE_CHARACTERS = 4_000;

/** Characters a piece repeats from the one before it, so a name across a cut is seen whole. */
export const PII_REDACTION_MODEL_PIECE_OVERLAP = 200;

/** Split calls one process runs at once; a span takes free ones, never queues (decision 9). */
export const PII_REDACTION_MODEL_SPLIT_SLOTS = 2;

/** All of a split span's calls together, the same cap one call has today (decision 9). */
export const PII_REDACTION_MODEL_SPAN_BUDGET_MS = 50_000;

/** A call our own abort rejects holds its slot this long from its start: the model's 55 s + 5 s. */
export const PII_REDACTION_MODEL_ABORTED_SLOT_HOLD_MS = 60_000;

/** A warm call's time per character: 10 s for 4,000, from 4.4 s at 2,000 and 63 s at 20,000. */
export const PII_REDACTION_MODEL_ESTIMATED_MS_PER_CHARACTER = 2.5;

/** A slice of one text, `[start, end)` in UTF-16; `whole` when it is the entire text. */
export type SplitPiece = Readonly<{ text: number; start: number; end: number; whole: boolean }>;

/** One invoke of the split model: one or more pieces, at most 4,000 characters in all. */
export type SplitCall = Readonly<{ pieces: readonly SplitPiece[] }>;

/** How a span batch reaches the model: one call as today, split, or Presidio for its length. */
export type SpanPlan =
  | Readonly<{ kind: "single" }>
  | Readonly<{ kind: "split"; calls: readonly SplitCall[] }>
  | Readonly<{ kind: "too_long" }>;

/** The model's answer for one piece, as its Presidio route returns it. */
export type PieceAnswer = Readonly<{ piece: SplitPiece; findings: unknown; anonymized: unknown }>;

/** Where the split model is reached; only a Lambda function ARN splits (decision 8). */
export type SplitModelTarget =
  | Readonly<{ kind: "lambda"; functionArn: string; region: string }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "invalid"; reason: string }>;

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

export function splitModelTargetOf(setting: string | undefined): SplitModelTarget {
  const target = piiRedactionModelTargetOf(setting);
  if (target.kind === "http") {
    return {
      kind: "invalid",
      reason: "PII_REDACTION_MODEL_SPLIT_ENDPOINT is not a Lambda function ARN",
    };
  }
  return target;
}

/** The plan for a span batch; `splitting` says whether a split model is set. */
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
 * A long text cut at whitespace: a piece ends before the last whitespace run within 4,000 of
 * its start, and the next starts at the word holding the character 200 before that end. No piece
 * starts or ends on a character the model trims, so its offsets index the raw piece.
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
    let next = end - PII_REDACTION_MODEL_PIECE_OVERLAP;
    while (next > start && !isPythonSpace(text[next - 1])) next--;
    next = skipSpaces({ text, from: next });
    start = next > pieces.at(-1)!.start ? next : end;
  }
  return pieces;
}

/** Where a piece from `start` ends: before a whitespace run, or a hard cut in a 4,000-long word. */
function cutBefore({ text, start }: { text: string; start: number }): number {
  const limit = start + PII_REDACTION_MODEL_PIECE_CHARACTERS;
  let end = limit;
  while (end > start && !isPythonSpace(text[end])) end--;
  while (end > start && isPythonSpace(text[end - 1])) end--;
  if (end > start) return end;
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
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
  return Math.max(...busyUntil) <= PII_REDACTION_MODEL_SPAN_BUDGET_MS;
}

/**
 * Whether the model's offsets for this cut piece index its raw characters (decision 5): no
 * backslash it could unfold as JSON, nothing at either end it would trim.
 */
export function isPlaceablePiece(piece: string): boolean {
  return (
    piece.length > 0 &&
    !piece.includes("\\") &&
    !isPythonSpace(piece[0]) &&
    !isPythonSpace(piece.at(-1))
  );
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
    const shift = answer.piece.whole ? 0 : answer.piece.start;
    found[answer.piece.text]?.push(
      ...parsed.data.map((finding) => ({
        ...finding,
        start: finding.start + shift,
        end: finding.end + shift,
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
  const toCodeUnit = codepointToCodeUnitConverter(pieceText);
  const findings = parsed.data.map((finding) => ({
    ...finding,
    start: toCodeUnit(finding.start),
    end: toCodeUnit(finding.end),
  }));
  if (findings.some((f) => f.start < 0 || f.end > pieceText.length || f.start >= f.end)) {
    return "unplaceable";
  }
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
