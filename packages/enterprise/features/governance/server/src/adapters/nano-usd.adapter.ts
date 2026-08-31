/**
 * Money as an exact integer count of 1e-9 USD, and back to a decimal string.
 *
 * Governance prices a share of an hourly warehouse bill, which is routinely a
 * fraction of a cent. Float arithmetic on those is how a busy workspace comes
 * to report nothing at all, so the whole pipeline carries bigint nano-USD and
 * converts only at its two edges: reading a vendor's decimal, and showing a
 * customer dollars.
 *
 * `usdToNanoUsd` parses the decimal itself rather than going through `Number`,
 * because that is the step the precision would be lost at. It accepts what a
 * vendor actually sends — a sign, a bare fraction, an exponent — and rounds
 * half-up at the ninth decimal place.
 */

const NANO_PER_USD = 1_000_000_000n;
const NANO_DIGITS = 9;
const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export function usdToNanoUsd(value: { toString(): string }): bigint {
  const raw = value.toString().trim();
  const match = DECIMAL_PATTERN.exec(raw);
  const [, sign = "", whole = "", fraction = "", exponent] = match ?? [];
  if (!match || (whole === "" && fraction === "")) {
    throw new Error(`Not a decimal money amount: ${JSON.stringify(raw)}`);
  }
  const digits = whole + fraction;
  const pointAt = whole.length + Number(exponent ?? 0) + NANO_DIGITS;
  const nanoDigits =
    pointAt <= 0
      ? "0"
      : pointAt >= digits.length
        ? digits + "0".repeat(pointAt - digits.length)
        : digits.slice(0, pointAt);
  const remainder =
    pointAt <= 0
      ? "0".repeat(-pointAt) + digits
      : pointAt >= digits.length
        ? ""
        : digits.slice(pointAt);
  const nano = BigInt(nanoDigits) + (/^[5-9]/.test(remainder) ? 1n : 0n);
  return sign === "-" ? -nano : nano;
}

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
