export type RowHeight = "s" | "m" | "l";

export const DEFAULT_ROW_HEIGHT: RowHeight = "m";

export const ROW_HEIGHT_OPTIONS: readonly {
  value: RowHeight;
  label: string;
}[] = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large" },
];

export const COLLAPSED_CELL_HEIGHT_PX: Record<RowHeight, number> = {
  s: 60,
  m: 140,
  l: 360,
};

export const ESTIMATED_ROW_HEIGHT_PX: Record<RowHeight, number> = {
  s: 100,
  m: 180,
  l: 400,
};

/** How much of a value a collapsed cell draws: a little more than its height shows, never all. */
const COLLAPSED_PREVIEW_LIMITS: Record<RowHeight, { chars: number; lines: number }> = {
  s: { chars: 400, lines: 6 },
  m: { chars: 1_000, lines: 12 },
  l: { chars: 2_500, lines: 30 },
};

/**
 * The start of a long value that a collapsed cell draws. A cell clamps by height, but the browser
 * still lays out all the text it is given, so the full value is drawn only once the cell expands.
 */
export const collapsedPreviewOf = ({
  text,
  rowHeight,
}: {
  text: string;
  rowHeight: RowHeight;
}): { preview: string; isCut: boolean } => {
  const { chars, lines } = COLLAPSED_PREVIEW_LIMITS[rowHeight];
  let end = Math.min(text.length, chars);
  let newlines = 0;
  for (let index = 0; index < end; index++) {
    if (text.charCodeAt(index) !== 10) continue;
    newlines++;
    if (newlines >= lines) {
      end = index;
      break;
    }
  }
  return { preview: text.slice(0, end), isCut: end < text.length };
};
