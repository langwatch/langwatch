export function percentile({ values, p }: { values: number[]; p: number }): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];

  if (lowerValue === void 0 || upperValue === void 0) {
    return 0;
  }

  if (lower === upper) {
    return lowerValue;
  }

  const weight = rank - lower;

  return lowerValue * (1 - weight) + upperValue * weight;
}
