/**
 * Money at the REST wire seam.
 *
 * Every amount this surface publishes is published twice: the `_usd` decimal
 * STRING, which is the display value, and the `_nano_usd` integer, which is
 * the canonical figure to do arithmetic on. The spend surfaces already carry
 * nano-USD integers, so a caller reconciling a budget against spend events
 * compares like with like instead of parsing decimals.
 *
 * Both fields are derived from ONE exact integer here, so the pair always
 * reconciles. The float shortcuts they replace do not: `nano / 1e9` puts the
 * drift back that the integer exists to avoid, and a ClickHouse `Float64` sum
 * stringifies as `"0.000044999999999999996"` for 45 micro-USD, which is a
 * measurement artifact rather than a price anybody charged.
 */

/**
 * What every `_usd` display string on this surface promises.
 *
 * Published on each field so the generated document STATES the format instead
 * of leaving a caller to infer it from examples. A `z.string()` on its own
 * documents a money field as "some text".
 */
export const USD_DISPLAY_STRING_FORMAT =
  "Decimal string, up to 9 fractional digits, trailing zeros trimmed, never exponent notation.";

/** Nano-USD per USD, the integer money unit the spend surfaces already use. */
const NANO_PER_USD = 1_000_000_000n;

/** Fractional digits in one nano-USD, and so the most a display string shows. */
const NANO_DIGITS = 9;

/**
 * `[sign][whole][.fraction][e[sign]exponent]`.
 *
 * Exponent notation is accepted because ClickHouse's `toString` of a `Float64`
 * emits it for small sums, and a sub-cent spend is exactly the amount this
 * surface has to render.
 */
const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * A money amount as an exact nano-USD integer.
 *
 * Scales the DECIMAL STRING rather than the float: `toNumber() * 1e9` on a
 * six-decimal value lands a cent or two off for amounts a budget actually
 * holds, which is the whole reason the integer unit exists.
 *
 * Digits past the ninth round half away from zero, because the input is not
 * always exact to begin with. A `Float64` sum arrives carrying its own drift,
 * and truncating there would publish that drift as the amount: the 45
 * micro-USD that stringifies as `0.000044999999999999996` would become 44999
 * nano rather than 45000.
 *
 * Throws on anything that is not a decimal amount. A money field is not a
 * place to guess, and the alternative is publishing `NaN` as a price.
 */
export function usdToNanoUsd(value: { toString(): string }): bigint {
  const raw = value.toString().trim();
  const match = DECIMAL_PATTERN.exec(raw);
  const [, sign = "", whole = "", fraction = "", exponent] = match ?? [];
  if (!match || (whole === "" && fraction === "")) {
    throw new Error(`Not a decimal money amount: ${JSON.stringify(raw)}`);
  }

  // Every significant digit, with the point's position tracked separately:
  // shifting a decimal point is index arithmetic, never multiplication.
  const digits = whole + fraction;
  // Where the point sits once the exponent is applied AND the value is scaled
  // by 1e9. Everything left of it is whole nano-USD; everything right is the
  // remainder that decides the rounding.
  const pointAt = whole.length + Number(exponent ?? 0) + NANO_DIGITS;

  let nanoDigits: string;
  let remainder: string;
  if (pointAt <= 0) {
    nanoDigits = "0";
    remainder = "0".repeat(-pointAt) + digits;
  } else if (pointAt >= digits.length) {
    nanoDigits = digits + "0".repeat(pointAt - digits.length);
    remainder = "";
  } else {
    nanoDigits = digits.slice(0, pointAt);
    remainder = digits.slice(pointAt);
  }

  // Half away from zero, decided by the first dropped digit alone: the ones
  // behind it can only push the value further in the direction it already
  // rounds, so they cannot change the answer.
  const roundsUp = /^[5-9]/.test(remainder);
  const nano = BigInt(nanoDigits) + (roundsUp ? 1n : 0n);
  return sign === "-" ? -nano : nano;
}

/**
 * A nano-USD integer as the decimal string the wire publishes.
 *
 * Integer division and a padded remainder, so the digits are read out rather
 * than computed: `nano / 1e9` is float division and reintroduces the drift,
 * and the `.toFixed(6)` that used to hide it also dropped the three digits the
 * nano unit is named for, rendering a one-nano charge as `"0.000000"`.
 *
 * Up to nine fractional digits, trailing zeros trimmed, and never exponent
 * notation: one nano-USD reads `"0.000000001"`, not `"1e-9"`.
 */
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

/**
 * The display string for any amount this surface holds, whatever it holds it
 * as: a Prisma `Decimal`, a ClickHouse `Float64` already stringified, or a
 * decimal string that was passed through untouched.
 *
 * Routing every `_usd` field through here is what makes the promise on the
 * wire one promise. The value is normalised into nano first, so the string a
 * caller displays and the integer they reconcile against are the same number.
 */
export function usdDisplayString(value: { toString(): string }): string {
  return nanoUsdToDecimalString(usdToNanoUsd(value));
}

/**
 * A money amount as a nano-USD JSON number, or null above
 * `Number.MAX_SAFE_INTEGER` (about 9.007e6 USD).
 *
 * Null rather than the number, because a JSON number past that has silently
 * lost its low digits and a wrong money figure is worse than an absent one.
 * The display string has no such ceiling: it is digits, so it stays exact and
 * keeps reading for amounts whose integer cannot be published.
 */
export function decimalUsdToNanoUsd(value: {
  toString(): string;
}): number | null {
  const nano = usdToNanoUsd(value);
  if (
    nano > BigInt(Number.MAX_SAFE_INTEGER) ||
    nano < -BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return Number(nano);
}
