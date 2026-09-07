export function countFlatLeaves(
  obj: Record<string, unknown> | undefined | null,
): number {
  if (!obj) return 0;
  let n = 0;
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      n += countFlatLeaves(v as Record<string, unknown>);
    } else {
      n += 1;
    }
  }
  return n;
}
