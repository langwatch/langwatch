/**
 * ClickHouse serialises Int64 values as strings. Keep the conversion exact
 * until the public usage response is deliberately rendered as a number.
 */
export function parseSummedNanoUsd(value: unknown): number {
  const parsed = BigInt(String(value ?? 0));
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < 0n) {
    throw new Error(`Summed nano-USD value ${parsed} exceeds the safe integer range`);
  }
  return Number(parsed);
}

export function nanoUsdToDecimalString(nano: bigint | number): string {
  const exact = typeof nano === "bigint" ? nano : BigInt(Math.round(nano));
  const magnitude = exact < 0n ? -exact : exact;
  const fraction = (magnitude % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  const sign = exact < 0n ? "-" : "";
  const whole = magnitude / 1_000_000_000n;
  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
