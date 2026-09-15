/**
 * Currency formatter for gateway-budget amounts. Preserves sub-cent precision
 * since modern small-model costs routinely fall below $0.01.
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
