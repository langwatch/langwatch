export type RowHeight = "s" | "m" | "l";

export const DEFAULT_ROW_HEIGHT: RowHeight = "m";

export const ROW_HEIGHT_OPTIONS: ReadonlyArray<{
  value: RowHeight;
  label: string;
}> = [
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
