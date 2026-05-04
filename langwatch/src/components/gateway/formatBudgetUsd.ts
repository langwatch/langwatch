/**
 * Currency formatter for gateway-budget amounts.
 *
 * Per-request costs in modern small-model workloads routinely fall
 * in the $0.0001–$0.001 range. Truncating to 2 decimals ("$0.00")
 * makes it impossible to tell whether spend is genuinely zero or
 * just sub-cent.
 *
 * Formatting strategy:
 *   - n === 0          → "$0.00"          (no spend)
 *   - 0 < n < 0.01     → "$0.000165"      (full precision under a cent)
 *   - 0.01 ≤ n < 1     → "$0.12345"       (5 decimals, drops trailing zeros)
 *   - n ≥ 1            → "$1.23"          (2 decimals)
 */
export function formatBudgetUsd(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "—";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0.00";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${trimTrailingZeros(n.toFixed(5))}`;
  return `$${trimTrailingZeros(n.toFixed(6))}`;
}

function trimTrailingZeros(decimalString: string): string {
  if (!decimalString.includes(".")) return decimalString;
  return decimalString.replace(/0+$/, "").replace(/\.$/, "");
}
