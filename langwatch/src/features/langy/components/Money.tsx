/**
 * A money value that is readable at a glance and exact on demand.
 *
 * `$0.41456935` is what the raw number looks like, and it is unreadable — the
 * eye has to count digits to find the decimal point, and nine of them carry no
 * information for a human comparing two figures. But rounding to `$0.41` and
 * throwing the rest away is wrong too: sub-cent costs are the norm for a single
 * trace, and at that scale the digits ARE the value.
 *
 * So both. The rounded figure is what you read; the exact one is one hover (or
 * one tap) away, and is what gets copied. Semantically this is an abbreviation
 * of a longer value, which is exactly what `<abbr>` means, so the title lands on
 * the right element for screen readers and native tooltips alike.
 */
import { chakra } from "@chakra-ui/react";

/** Digits to show once a value is big enough that fractions stop mattering. */
const CENTS = 2;
/** Digits to show below a cent, where rounding to 2dp would print "$0.00". */
const SUB_CENT = 4;

/**
 * The short form: two decimals normally, four when the value is smaller than a
 * cent (where two would round it to nothing and tell the reader less than
 * nothing — it would tell them it was free).
 */
export function formatMoneyShort(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  if (amount === 0) return "$0.00";
  const digits = Math.abs(amount) < 0.01 ? SUB_CENT : CENTS;
  return `$${amount.toFixed(digits)}`;
}

/**
 * The exact form, with the trailing zeros JavaScript leaves behind removed —
 * `0.41` rather than `0.410000000000000` — so the disclosure shows precision
 * that is really there.
 */
export function formatMoneyExact(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const text = amount.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return `$${text}`;
}

export function Money({
  amount,
  /** Hide the exact value — for a figure already shown in full nearby. */
  exact = true,
}: {
  amount: number;
  exact?: boolean;
}) {
  const short = formatMoneyShort(amount);
  const full = formatMoneyExact(amount);

  // Identical strings mean there is nothing to reveal, so the abbreviation
  // would be a lie and the dotted underline an invitation to nothing.
  if (!exact || short === full) {
    return <chakra.span fontVariantNumeric="tabular-nums">{short}</chakra.span>;
  }

  return (
    <chakra.abbr
      title={full}
      fontVariantNumeric="tabular-nums"
      textDecoration="underline dotted"
      textDecorationColor="border.emphasized"
      textUnderlineOffset="2px"
      cursor="help"
      // `abbr` is inline; without this the dotted rule renders under the
      // surrounding whitespace too and reads as a typo.
      display="inline-block"
    >
      {short}
    </chakra.abbr>
  );
}
