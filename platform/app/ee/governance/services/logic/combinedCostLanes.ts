// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The connected view's arithmetic: the bill is the total, and gateway metering
 * splits it (ADR-128 §2, §7).
 *
 * Four rules, and all four are about not inventing money.
 *
 *   1. The total shown is the BILL, so the screen's number can be held against
 *      the invoice. Gateway metering never replaces it and is never added to
 *      it.
 *   2. Metering splits that total. The part no gateway row explains is its own
 *      line, never silently netted away.
 *   3. Metering above the bill is a variance line, never a subtraction, and
 *      never a negative number we invented. A provider's own refund CAN make a
 *      day genuinely negative, and that renders as-is — clamping it to zero
 *      silently eats money.
 *   4. A day the bill has not reached yet shows the gateway figure marked
 *      *estimated*, because gateway rows arrive instantly and bills land days
 *      later. Derived here at read time from whether a bill row exists, stored
 *      nowhere — the same pattern the big cloud cost pages use, so Tuesday's
 *      $4.20 becoming Thursday's $6.00 never looks like a silent change.
 *
 * Integer nano-units throughout (§3): every figure is a `bigint`, and nothing
 * here divides. Amounts in different currency codes are never added — where the
 * bill and its keys disagree on currency and the biller published no conversion
 * of its own, the mapping is ineligible and the two lanes are reported side by
 * side instead of split.
 *
 * Pure. No clock, no database, no rounding.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */

/** Why a bill and the keys mapped to it could not be combined. */
export const COVERAGE_INELIGIBLE = {
  /** §3: the bill and its keys are priced in different currencies, and the
   *  biller published no conversion, so no split can be computed without
   *  inventing an exchange rate. */
  CROSS_CURRENCY: "cross_currency",
} as const;
export type CoverageIneligibleReason =
  (typeof COVERAGE_INELIGIBLE)[keyof typeof COVERAGE_INELIGIBLE];

/** An amount and the currency it is denominated in. Never added across codes. */
export interface CurrencyAmount {
  amountNano: bigint;
  currencyCode: string;
}

/** One provider-day's two lanes, as the read side hands them over. */
export interface ProviderDayLanes {
  day: string;
  provider: string;
  /**
   * The provider's own figure for this day, or null when no bill row has landed
   * for it yet. Null is what makes a day read as *estimated*; a bill of zero is
   * a bill and reads as billed.
   */
  bill: CurrencyAmount | null;
  /**
   * Gateway metering on keys this bill covered on this day, or null when the
   * bill covers no key that spent anything. Its currency is the gateway's, not
   * necessarily the bill's.
   */
  coveredGateway: CurrencyAmount | null;
  /** Gateway metering on keys no bill covered on this day. */
  unmappedGateway: CurrencyAmount | null;
}

/** How gateway metering divides up the total. */
export interface BillSplit {
  /** The part of the total gateway metering accounts for. Never negative. */
  attributedNano: bigint;
  /** The rest of the total. Negative on a refund day, and rendered as-is. */
  unallocatedNano: bigint;
  /** How far metering ran OVER the total. Never negative, never subtracted. */
  overMeteredNano: bigint;
}

/** One provider-day, ready to render. */
export interface CombinedProviderDay {
  day: string;
  provider: string;
  /**
   * The figure the screen shows, and what it is. `billed` reconciles to the
   * provider's cost feed; `estimated` is gateway metering standing in until the
   * bill lands. Null when neither lane said anything.
   */
  total: (CurrencyAmount & { basis: "billed" | "estimated" }) | null;
  /** How the total divides, or null when no mapping could be applied to it. */
  split: BillSplit | null;
  /** Gateway dollars no bill claims, in their own currency. Real money. */
  metered: CurrencyAmount | null;
  /** Why `split` is null despite there being both a bill and covered metering. */
  ineligibleReason: CoverageIneligibleReason | null;
}

/**
 * Combines one provider-day's lanes into the figure and the lines beneath it.
 *
 * The one arithmetic invariant, which holds in every branch including refunds:
 * `attributedNano + unallocatedNano` equals the total exactly. `overMeteredNano`
 * sits outside that sum on purpose — it is a comparison, not a component, and
 * folding it in would be the subtraction rule 3 forbids.
 */
export function combineProviderDay(
  lanes: ProviderDayLanes,
): CombinedProviderDay {
  const { bill, coveredGateway, unmappedGateway } = lanes;
  const base = { day: lanes.day, provider: lanes.provider };

  if (bill === null) {
    // No bill has reached this day. Covered metering stands in for one and says
    // so; metering on unmapped keys was never going to be part of a bill and is
    // reported as itself.
    return {
      ...base,
      total:
        coveredGateway === null
          ? null
          : { ...coveredGateway, basis: "estimated" },
      split:
        coveredGateway === null
          ? null
          : {
              attributedNano: coveredGateway.amountNano,
              unallocatedNano: 0n,
              overMeteredNano: 0n,
            },
      metered: unmappedGateway,
      ineligibleReason: null,
    };
  }

  const total = { ...bill, basis: "billed" as const };

  if (coveredGateway === null) {
    // A bill nothing is mapped to. The whole of it is unexplained by metering,
    // which is the honest reading of a bill whose keys nobody has named yet.
    return {
      ...base,
      total,
      split: {
        attributedNano: 0n,
        unallocatedNano: bill.amountNano,
        overMeteredNano: 0n,
      },
      metered: unmappedGateway,
      ineligibleReason: null,
    };
  }

  if (coveredGateway.currencyCode !== bill.currencyCode) {
    // Splitting would mean converting, and nobody here has a rate that is not
    // invented. Both lanes render, each in its own currency, and the covered
    // metering joins the metered line rather than disappearing: its dollars are
    // real whether or not they can be matched against this bill.
    return {
      ...base,
      total,
      split: null,
      metered: addSameCurrency(coveredGateway, unmappedGateway),
      ineligibleReason: COVERAGE_INELIGIBLE.CROSS_CURRENCY,
    };
  }

  const billNano = bill.amountNano;
  const meteredNano = coveredGateway.amountNano;
  // Clamped at zero because metering cannot account for a refund: on a negative
  // day the whole (negative) figure is unallocated, and the metering that ran
  // anyway shows up as the variance below.
  const attributedNano =
    billNano <= 0n ? 0n : meteredNano < billNano ? meteredNano : billNano;

  return {
    ...base,
    total,
    split: {
      attributedNano,
      unallocatedNano: billNano - attributedNano,
      overMeteredNano: meteredNano > billNano ? meteredNano - billNano : 0n,
    },
    metered: unmappedGateway,
    ineligibleReason: null,
  };
}

/**
 * Adds two amounts that may or may not be present, refusing to add across
 * currencies.
 *
 * Where they disagree the second is dropped rather than converted, and the
 * caller is expected to have already established that this cannot happen: the
 * gateway prices its whole lane in one currency, so both arguments here are
 * always the gateway's. The check is the guard that keeps that assumption from
 * quietly becoming a wrong sum if the gateway ever prices in two.
 */
function addSameCurrency(
  first: CurrencyAmount,
  second: CurrencyAmount | null,
): CurrencyAmount {
  if (second === null || second.currencyCode !== first.currencyCode) {
    return first;
  }
  return {
    amountNano: first.amountNano + second.amountNano,
    currencyCode: first.currencyCode,
  };
}
