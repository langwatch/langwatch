/**
 * Image chips in the composer's text. The draft holds `[▣ name.png]` where an image was put, and
 * the composer draws that text as a chip over the field, so every character keeps its place and
 * the caret lines up. Spec: modules/langy/specs/langy-image-attachments.feature
 */

/** The glyph a chip's text holds where its icon is drawn. */
export const MARKER_GLYPH = "▣";

export type MarkerRange = Readonly<{ key: string; start: number; end: number }>;

const UNNAMED_PASTE = /^(image|blob|untitled)?\.?(png|jpe?g|gif|webp)?$/i;

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function plainLabelName(fileName: string): string {
  return fileName.replace(/[[\]\n]/g, "").trim() || "image";
}

/** The chip's text for an image, made unique among the chips already in the draft. */
export function markerLabelFor({
  fileName,
  taken,
}: {
  fileName: string;
  taken: readonly string[];
}): string {
  const name = plainLabelName(fileName);
  const labelOf = (candidate: string) => `[${MARKER_GLYPH} ${candidate}]`;
  if (!taken.includes(labelOf(name))) return labelOf(name);
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let count = 2;
  while (taken.includes(labelOf(`${stem} (${count})${extension}`))) count += 1;
  return labelOf(`${stem} (${count})${extension}`);
}

/** The file name a chip's text shows: `[▣ name.png]` reads `name.png`. */
export function fileNameOfLabel(label: string): string {
  return label.slice(MARKER_GLYPH.length + 2, -1);
}

/** A pasted image's name: its own, or `pasted-<6 hex>.png` when the clipboard gave none. */
export function pastedNameFor({
  fileName,
  mediaType,
  randomHex,
}: {
  fileName: string;
  mediaType: string;
  randomHex: () => string;
}): string {
  if (!UNNAMED_PASTE.test(fileName.trim())) return fileName;
  const extension = EXTENSIONS[mediaType.toLowerCase()] ?? "png";
  return `pasted-${randomHex().slice(0, 6)}.${extension}`;
}

/** Six random hex digits from the browser's crypto. */
export function randomHex(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The draft with chips put over the selection, each spaced from the words around it. */
export function insertMarkers({
  text,
  start,
  end,
  labels,
}: {
  text: string;
  start: number;
  end: number;
  labels: readonly string[];
}): Readonly<{ text: string; caret: number }> {
  if (labels.length === 0) return { text, caret: end };
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before.length === 0 || /\s$/.test(before) ? "" : " ";
  const tail = /^\s/.test(after) ? "" : " ";
  const inserted = `${lead}${labels.join(" ")}${tail}`;
  return { text: before + inserted + after, caret: before.length + inserted.length };
}

/** Where each chip sits in the text; a chip whose text was broken is not found. */
export function markerRangesIn({
  text,
  markers,
}: {
  text: string;
  markers: readonly Readonly<{ key: string; label: string }>[];
}): MarkerRange[] {
  return markers
    .map((marker) => ({ marker, start: text.indexOf(marker.label) }))
    .filter(({ start }) => start >= 0)
    .map(({ marker, start }) => ({ key: marker.key, start, end: start + marker.label.length }))
    .toSorted((left, right) => left.start - right.start);
}

/** The chips whose text is gone from the draft, so their images go too. */
export function markersMissingFrom({
  text,
  markers,
}: {
  text: string;
  markers: readonly Readonly<{ key: string; label: string }>[];
}): string[] {
  return markers.filter((marker) => !text.includes(marker.label)).map((marker) => marker.key);
}

/** Backspace after a chip or Delete before one removes the whole chip; undefined otherwise. */
export function markerDeletion({
  text,
  ranges,
  start,
  end,
  key,
}: {
  text: string;
  ranges: readonly MarkerRange[];
  start: number;
  end: number;
  key: string;
}): Readonly<{ text: string; caret: number }> | undefined {
  if (start !== end) return undefined;
  let hit: MarkerRange | undefined;
  if (key === "Backspace") hit = ranges.find((range) => range.end === start);
  if (key === "Delete") hit = ranges.find((range) => range.start === start);
  if (!hit) return undefined;
  return { text: text.slice(0, hit.start) + text.slice(hit.end), caret: hit.start };
}

/** The caret never rests inside a chip: it moves to the chip's nearer edge. */
export function snapCaret({
  ranges,
  caret,
}: {
  ranges: readonly MarkerRange[];
  caret: number;
}): number {
  const inside = ranges.find((range) => caret > range.start && caret < range.end);
  if (!inside) return caret;
  return caret - inside.start < inside.end - caret ? inside.start : inside.end;
}

/** The draft without one chip, and the space it brought with it. */
export function withoutMarker({ text, label }: { text: string; label: string }): string {
  const at = text.indexOf(label);
  if (at < 0) return text;
  const before = text.slice(0, at);
  const after = text.slice(at + label.length);
  if (before.endsWith(" ") && (after.startsWith(" ") || after.length === 0)) {
    return before.slice(0, -1) + after;
  }
  return before + (after.startsWith(" ") && before.length === 0 ? after.slice(1) : after);
}

export type TextPiece =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "chip"; key: string; label: string }>;

/** The pieces a text splits into around its chips, in order, for drawing. */
export function textPiecesOf({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly MarkerRange[];
}): TextPiece[] {
  const pieces: TextPiece[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start < at) continue;
    if (range.start > at) pieces.push({ kind: "text", text: text.slice(at, range.start) });
    pieces.push({ kind: "chip", key: range.key, label: text.slice(range.start, range.end) });
    at = range.end;
  }
  if (at < text.length) pieces.push({ kind: "text", text: text.slice(at) });
  return pieces;
}
