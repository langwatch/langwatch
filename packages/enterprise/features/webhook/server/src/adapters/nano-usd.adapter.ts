/**
 * Money on the wire: integer nano-USD in, a decimal string out.
 *
 * Spend is stored and carried as an integer count of 1e-9 USD, because a
 * share of one request's cost is routinely a fraction of a cent and float
 * arithmetic on money is how a busy workspace comes to report nothing at all.
 * Customers read dollars, so it is formatted once, here, on the way out.
 *
 * A non-integer input is rounded rather than refused. The alternative is a
 * `RangeError` from `BigInt`, thrown from inside a webhook delivery, for an
 * amount that was always an estimate to nine decimal places.
 */

const NANO_PER_USD = 1_000_000_000n;
const NANO_DIGITS = 9;

export function nanoUsdToDecimalString(nano: bigint | number): string {
  const exact = typeof nano === "bigint" ? nano : BigInt(Math.round(nano));
  const magnitude = exact < 0n ? -exact : exact;
  const fraction = (magnitude % NANO_PER_USD)
    .toString()
    .padStart(NANO_DIGITS, "0")
    .replace(/0+$/, "");
  const sign = exact < 0n ? "-" : "";
  const whole = magnitude / NANO_PER_USD;

  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
