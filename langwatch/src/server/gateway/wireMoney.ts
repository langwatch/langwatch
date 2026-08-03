/**
 * Money at the REST wire seam.
 *
 * A budget's amounts are stored as `Decimal(18,6)` and published two ways: the
 * `_usd` decimal STRING, which is the display value and survives a JSON
 * round-trip without float drift, and the `_nano_usd` integer, which is the
 * canonical figure to do arithmetic on. The spend surfaces already carry
 * nano-USD integers, so a caller reconciling a budget against spend events
 * compares like with like instead of parsing decimals.
 */
/** Nano-USD per USD, the integer money unit the spend surfaces already use. */
const NANO_PER_USD = 1_000_000_000n;

/**
 * A stored `Decimal(18,6)` money column as an exact integer of nano-USD.
 *
 * The decimal STRING is scaled rather than the float: `toNumber() * 1e9` on a
 * six-decimal value lands a cent or two off for amounts a budget actually
 * holds, which is the whole reason the integer field exists next to the
 * display string.
 *
 * Returns null above `Number.MAX_SAFE_INTEGER` (about 9.007e6 USD), because a
 * JSON number past that has silently lost precision and a wrong money figure
 * is worse than an absent one. The spend surfaces draw the same line.
 */
export function decimalUsdToNanoUsd(value: {
  toString(): string;
}): number | null {
  const raw = value.toString().trim();
  const negative = raw.startsWith("-");
  const [whole = "0", fraction = ""] = raw.replace(/^[+-]/, "").split(".");
  // Nine fractional digits IS the nano unit, so padding to nine and
  // concatenating is the scaling, with no float arithmetic anywhere.
  const scaled =
    BigInt(whole) * NANO_PER_USD + BigInt(fraction.padEnd(9, "0").slice(0, 9));
  const signed = negative ? -scaled : scaled;
  if (
    signed > BigInt(Number.MAX_SAFE_INTEGER) ||
    signed < -BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return Number(signed);
}
