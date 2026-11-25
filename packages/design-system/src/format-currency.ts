/**
 * Money through `Intl.NumberFormat`: the currency's own decimals (JPY none, USD two,
 * KWD three), the reader's locale for separators and symbol placement, and enough
 * extra digits that a model call's fraction of a cent never reads as zero.
 */

/**
 * `auto`: the currency's decimals, more below 1 until two significant digits show.
 * `exact`: every digit, up to 10 decimals. `compact`: `$1.2K`, for tiles and axes.
 * A number: exactly that many decimals.
 */
export type CurrencyPrecision = "auto" | "exact" | "compact" | number;

export interface FormatCurrencyOptions {
  amount: number;
  /** ISO 4217 code: `USD`, `EUR`, `JPY`. */
  currency: string;
  /** Defaults to the reader's. */
  locale?: string;
  precision?: CurrencyPrecision;
  /** `always` puts a `+` on gains, for deltas. */
  signDisplay?: "auto" | "always" | "exceptZero";
  currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name";
}

const AUTO_MAX_DECIMALS = 6;
const EXACT_MAX_DECIMALS = 10;

/** How many decimals the currency itself uses. */
export function currencyDecimals({
  currency,
  locale,
}: {
  currency: string;
  locale?: string;
}): number {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

function fractionDigits({
  amount,
  minor,
  precision,
}: {
  amount: number;
  minor: number;
  precision: Exclude<CurrencyPrecision, "compact">;
}): { min: number; max: number } {
  if (typeof precision === "number") return { min: precision, max: precision };
  if (precision === "exact") return { min: minor, max: Math.max(minor, EXACT_MAX_DECIMALS) };
  const size = Math.abs(amount);
  if (size === 0 || size >= 1) return { min: minor, max: minor };
  const needed = Math.ceil(-Math.log10(size)) + 1;
  return { min: minor, max: Math.min(AUTO_MAX_DECIMALS, Math.max(minor, needed)) };
}

/** The `Intl.NumberFormat` every money display goes through. */
export function currencyFormat({
  amount,
  currency,
  locale,
  precision = "auto",
  signDisplay = "auto",
  currencyDisplay = "symbol",
}: FormatCurrencyOptions): Intl.NumberFormat {
  if (precision === "compact") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay,
      signDisplay,
      notation: "compact",
      maximumFractionDigits: 1,
    });
  }
  const minor = currencyDecimals({ currency, locale });
  const digits = fractionDigits({ amount, minor, precision });
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay,
    signDisplay,
    minimumFractionDigits: digits.min,
    maximumFractionDigits: digits.max,
  });
}

/**
 * A non-zero amount too small for its precision reads `< $0.000001`, never `$0.00`.
 * Returns the floor to show, or null when the amount shows as itself.
 */
function belowFloor(options: FormatCurrencyOptions): number | null {
  const { amount } = options;
  if (amount === 0 || !Number.isFinite(amount) || options.precision === "compact") return null;
  const max = currencyFormat(options).resolvedOptions().maximumFractionDigits ?? 2;
  const floor = 10 ** -max;
  return Math.abs(amount) < floor / 2 ? floor : null;
}

export function formatCurrency(options: FormatCurrencyOptions): string {
  return formatCurrencyParts(options)
    .map((part) => part.value)
    .join("");
}

/** The formatted parts, so a display can size or tint the symbol apart from the figure. */
export function formatCurrencyParts(options: FormatCurrencyOptions): Intl.NumberFormatPart[] {
  const floor = belowFloor(options);
  if (floor === null) return currencyFormat(options).formatToParts(options.amount);
  const signed = options.amount < 0 ? -floor : floor;
  const parts = currencyFormat({ ...options, amount: signed }).formatToParts(signed);
  return [{ type: "literal", value: options.amount < 0 ? "> " : "< " }, ...parts];
}
