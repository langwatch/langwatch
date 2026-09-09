/** Whether a timestamp is usable by trace timing and storage anchors. */
export const isValidTimestamp = (value: number | null | undefined): value is number =>
  typeof value === "number" && value > 0 && Number.isFinite(value);
