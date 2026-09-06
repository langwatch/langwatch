/**
 * Parse a user-supplied instant flag (ISO-8601 or epoch milliseconds) into
 * epoch ms. Returns null when the value is neither, so callers own the exit.
 */
export const parseInstantOrNull = (value: string): number | null => {
  // Integer strings are epoch-ms candidates; Date.parse must never see
  // them (it misreads "1753791000000" and even "-5" as calendar dates).
  if (/^-?\d+$/.test(value)) {
    const ms = Number(value);
    return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
  }
  const iso = Date.parse(value);
  return Number.isNaN(iso) || iso <= 0 ? null : iso;
};
