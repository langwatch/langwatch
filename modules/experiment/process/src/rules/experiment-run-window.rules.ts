/**
 * The run manager's record of finished cells: one bit per ordinal, base64 in its state, so a
 * 5,000-cell run holds about 1 KB (specs/experiment-run-execution.md section 4).
 */

function bytesOf(bitmap: string): Buffer {
  return Buffer.from(bitmap, "base64");
}

/** Whether the cell at `ordinal` has finished. */
export function hasFinished({ bitmap, ordinal }: { bitmap: string; ordinal: number }): boolean {
  const byte = bytesOf(bitmap)[ordinal >> 3] ?? 0;
  return (byte & (1 << (ordinal & 7))) !== 0;
}

/** The bitmap with `ordinal` marked finished; marking a finished cell again changes nothing. */
export function markFinished({ bitmap, ordinal }: { bitmap: string; ordinal: number }): string {
  const current = bytesOf(bitmap);
  const bytes = Buffer.alloc(Math.max(current.length, (ordinal >> 3) + 1));
  current.copy(bytes);
  bytes[ordinal >> 3] = (bytes[ordinal >> 3] ?? 0) | (1 << (ordinal & 7));
  return bytes.toString("base64");
}

/** How many cells in `[from, to)` have finished. */
export function countFinished({
  bitmap,
  from,
  to,
}: {
  bitmap: string;
  from: number;
  to: number;
}): number {
  const bytes = bytesOf(bitmap);
  let count = 0;
  for (let ordinal = from; ordinal < to; ordinal += 1) {
    if ((bytes[ordinal >> 3] ?? 0) & (1 << (ordinal & 7))) count += 1;
  }
  return count;
}
