/**
 * Money at REST wire seam: centralized conversions for four packages; both
 * decimal strings and nano-USD integers derived from one exact integer.
 */

/**
 * What every `_usd` display string on this surface promises. Published on
 * each field so the document STATES the format rather than a caller
 * inferring it from examples — a bare `z.string()` says "some text".
 */
export const USD_DISPLAY_STRING_FORMAT =
  "Decimal string, up to 9 fractional digits, trailing zeros trimmed, never exponent notation.";

/** Nano-USD per USD, the integer money unit the spend surfaces already use. */
const NANO_PER_USD = 1_000_000_000n;

/** Fractional digits in one nano-USD, and so the most a display string shows. */
const NANO_DIGITS = 9;

/**
 * `[sign][whole][.fraction][e[sign]exponent]`. Exponent notation is accepted
 * because ClickHouse's `toString` of a `Float64` emits it for small sums —
 * exactly the sub-cent spend this surface has to render.
 */
const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Exact nano-USD integer from decimal string; rounds half-away from zero.
 * Throws on non-decimal amounts.
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
 * Decimal string from nano-USD integer; up to 9 fractional digits,
 * no exponent notation, trailing zeros trimmed.
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
 * Decimal string from nano-minor (like nano-USD but for non-USD currencies);
 * currency code not taken or rendered.
 */
export function nanoMinorToDecimalString(nano: bigint | number): string {
  return nanoUsdToDecimalString(nano);
}

/**
 * Display string for any amount; routed through nano for single promise on
 * the wire.
 */
export function usdDisplayString(value: { toString(): string }): string {
  return nanoUsdToDecimalString(usdToNanoUsd(value));
}

/**
 * Nano-USD as JSON number or null above MAX_SAFE_INTEGER; display string has
 * no ceiling.
 */
export function convertDecimalUsdToNanoUsd(value: { toString(): string }): number | null {
  const nano = usdToNanoUsd(value);
  if (nano > BigInt(Number.MAX_SAFE_INTEGER) || nano < -BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(nano);
}

/**
 * Parse ClickHouse SUM of nano-USD as JSON number; refuses values past
 * MAX_SAFE_INTEGER and negative totals.
 */
export function parseSummedNanoUsd(value: unknown): number {
  const parsed = BigInt(
    typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? value : 0,
  );
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < 0n) {
    throw new Error(`Summed nano-USD value ${parsed} exceeds the safe integer range`);
  }

  return Number(parsed);
}

/**
 * Display string for a budget amount. Keeps sub-cent precision, since modern
 * small-model costs routinely fall below $0.01, and prints an em dash rather
 * than a number for an amount that is absent or unparseable.
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
