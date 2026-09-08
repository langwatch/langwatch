import type { GovernanceAzureBillingNote } from "@ee/governance/services/azureBillingNote";

import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";

/**
 * Thousands separators, which a lane total needs and a per-request cost does
 * not. Built once: constructing an `Intl` formatter is not free, and this runs
 * per lane per render.
 *
 * Two of them, because the cents stop being information somewhere along the
 * scale. On a four-figure bill the last two digits are below anything a reader
 * acts on, and printing them costs three characters on the largest number on
 * the screen. Under a thousand they still separate one figure from another.
 */
const GROUPED_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const GROUPED_USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Above this, cents are noise; below it, they are the figure. */
const CENTS_STOP_MATTERING_AT = 1000;

/**
 * A cost lane's amount, or an em dash when no figure is held.
 *
 * The digits come from `formatBudgetUsd` below a dollar, where its whole
 * reason for existing applies: gateway costs land in the $0.0001 range and
 * rounding them to `$0.00` loses the difference between "nearly nothing" and
 * "nothing". A LANE total is the other end of that scale — a provider's bill
 * for a quarter — and that function has no thousands separators, so a real
 * headline came out as `$227999.00`. Six unbroken digits is a number the
 * reader has to count with a finger, on the largest figure on the screen.
 *
 * So the split is by magnitude, not by caller: three bands, each printing what
 * carries information at that size. Sub-cent precision below a dollar, cents
 * and grouping in the middle, grouped whole dollars once the cents are smaller
 * than anything the figure is used to decide. All three stay in one function
 * because the boundaries are the interesting part, and a caller choosing a
 * formatter per amount is how they drift apart.
 *
 * Rounding to the dollar is a display choice, not a claim: the underlying
 * figure is untouched, and every trust note that qualifies it — revised,
 * provisional, unpriced — renders beside it unchanged.
 *
 * The sign is moved out front either way. `formatBudgetUsd`'s magnitude
 * branches all test `>=`, so a negative falls through to the six-decimal tail
 * and renders as `$-12.5`. A refund-heavy billed day is a real case here, and
 * `-$12.50` is the same number read the way a bill reads it.
 *
 * Null stays null all the way to the string: `formatBudgetUsd` answers an em
 * dash, never `$0.00`. A zero here would be a claim that nothing was spent.
 */
export function formatLaneUsd(amountUsd: number | null): string {
  if (amountUsd === null) return formatBudgetUsd(amountUsd);
  const magnitude = Math.abs(amountUsd);
  const digits = laneDigits(magnitude);
  return amountUsd < 0 ? `-${digits}` : digits;
}

/**
 * Which way a lane's window is running, as a percentage.
 *
 * The later half of the window against the earlier half, not the last point
 * against the one before it. The lane series arrives at whatever granularity
 * the read answers in — days from a real summary, months from an invented one
 * — and a last-point comparison would therefore mean something different on
 * every screen it appeared on, while measuring mostly the noise of a single
 * day. Halves say the same thing at any granularity: is this window ending
 * heavier than it started.
 *
 * Null when the comparison cannot be made honestly: fewer than four periods to
 * split, or an earlier half that holds nothing to divide by. Withheld days
 * (§21) are skipped rather than counted as zero, since a zero would report
 * money not spent when the truth is money not stated.
 */
export function laneTrendPct(
  points: readonly { value: number | null }[],
): number | null {
  const stated = points.filter(
    (point): point is { value: number } => point.value !== null,
  );
  if (stated.length < 4) return null;
  const middle = Math.floor(stated.length / 2);
  const sum = (from: number, to: number) =>
    stated.slice(from, to).reduce((total, point) => total + point.value, 0);
  const earlier = sum(0, middle);
  const later = sum(middle, stated.length);
  if (earlier <= 0) return null;
  return ((later - earlier) / earlier) * 100;
}

/** That percentage as a signed badge, or null when there is nothing to say. */
export function laneTrendBadge(changePct: number | null): string | null {
  if (changePct === null) return null;
  const rounded = Math.round(changePct);
  if (rounded === 0) return "level";
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function laneDigits(magnitude: number): string {
  if (magnitude >= CENTS_STOP_MATTERING_AT)
    return GROUPED_USD_WHOLE.format(magnitude);
  if (magnitude >= 1) return GROUPED_USD.format(magnitude);
  return formatBudgetUsd(magnitude);
}

/**
 * Product names for the SKU part numbers we have seen, keyed exactly as the
 * provider reports them.
 *
 * Deliberately short. A provider invents SKUs faster than anyone maintains a
 * table of them, so this covers the ones in front of us today and the fallback
 * below carries everything else — a mapping that has to be exhaustive to work
 * is a mapping that stops working.
 */
const SEAT_POOL_NAMES: Readonly<Record<string, string>> = {
  GITHUB_COPILOT_BUSINESS: "GitHub Copilot Business",
  GITHUB_COPILOT_ENTERPRISE: "GitHub Copilot Enterprise",
  COPILOT_STUDIO_PRO: "Copilot Studio Pro",
  MICROSOFT_365_COPILOT: "Microsoft 365 Copilot",
  VIRTUAL_AGENT_USL: "Virtual Agent USL",
};

/**
 * Fragments that are initialisms, not words, and stay upper case through the
 * fallback. Title-casing these produces "Usl" and "Api", which read as
 * misspellings rather than as the acronyms they are.
 */
const SEAT_POOL_INITIALISMS = new Set([
  "AI",
  "API",
  "CRM",
  "ERP",
  "GPT",
  "IDE",
  "ML",
  "RPA",
  "SDK",
  "USL",
  "VM",
]);

/**
 * A seat pool's name, as a person would write it.
 *
 * Providers report SKUs in screaming snake case — `GITHUB_COPILOT_BUSINESS` —
 * and the seat tile was printing them raw, which reads as a database key that
 * escaped onto a page rather than as the product somebody is paying for.
 *
 * Known SKUs get their real product name, capitalised the way the vendor
 * capitalises it ("GitHub", not "Github"), because that is the string a reader
 * will match against their invoice. Everything else is de-underscored and
 * title-cased so an unknown SKU still arrives as words, with initialisms left
 * alone. An unrecognised pool is the normal case, not the exception.
 */
export function seatPoolName(skuPartNumber: string): string {
  const known = SEAT_POOL_NAMES[skuPartNumber];
  if (known !== undefined) return known;
  const words = skuPartNumber
    .split(/[_\s]+/)
    .filter((part) => part !== "")
    .map(titleCaseFragment);
  // Nothing to show is worse than the raw key: a pool with no name at all
  // cannot be told from the one below it.
  return words.length === 0 ? skuPartNumber : words.join(" ");
}

function titleCaseFragment(fragment: string): string {
  const upper = fragment.toUpperCase();
  if (SEAT_POOL_INITIALISMS.has(upper)) return upper;
  // Digits and mixed forms ("365", "M365") are left as the provider wrote
  // them; only an all-alphabetic fragment is re-cased.
  if (!/^[A-Za-z]+$/.test(fragment)) return fragment;
  return upper.charAt(0) + fragment.slice(1).toLowerCase();
}

/** "EUR", "EUR and JPY", "EUR, JPY and GBP". */
function joinCurrencies(codes: readonly string[]): string {
  if (codes.length <= 1) return codes[0] ?? "";
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

/**
 * Why a lane shows no total.
 *
 * The honest wording matters more than it looks. The dominant cause is a
 * provider that bills in another currency, and in that case the amount IS
 * stated — it is stated in euros, or yen — so copy saying the usage "arrived
 * without an amount" describes something that did not happen, and a reader
 * holding the provider invoice can see it did not.
 *
 * Naming the currency is what turns the note from an apology into something
 * the reader can act on: they know which invoice to go and read. When nothing
 * names one — a cell recorded in dollars that still carries no dollar figure —
 * the sentence says only what we know, rather than guessing at a currency.
 */
export function laneWithheldTotalNote({
  currenciesWithoutUsdAmount,
}: {
  currenciesWithoutUsdAmount: readonly string[];
}): string {
  const withheld =
    "No total is shown until every amount can be stated in US dollars.";
  if (currenciesWithoutUsdAmount.length === 0) {
    return `Some usage in this lane has no amount stated in US dollars. ${withheld}`;
  }
  return `Some usage in this lane is billed in ${joinCurrencies(
    currenciesWithoutUsdAmount,
  )} rather than US dollars. ${withheld}`;
}

/**
 * The sentence the billed lane shows for each Azure billing note.
 *
 * The note itself — which of the closed list of reasons applies — is the read
 * side's decision (`azureBillingNoteFrom`, `@ee`); the words are panel copy
 * and live here with the rest of it. Digit-free on purpose, like the seat
 * lane's absence copy: these sentences explain why there is NO figure, and a
 * digit in one is a figure waiting to be misread. Each is honest about what
 * happened — a failed read says the data is missing, never that the bill was
 * empty, because those ask the reader for opposite things.
 */
export function azureBillingNoteSentence(
  note: GovernanceAzureBillingNote,
): string {
  switch (note) {
    case "prepaid_declared":
      return "This Copilot is declared as running on prepaid message packs, which never appear on the Azure bill — an empty bill here is expected.";
    case "no_spend_recorded":
      return "The Azure bill was read and holds no Copilot charges for this period.";
    case "billing_read_failed":
      return "The Azure bill could not be read, so its charges are missing here rather than empty. They appear as soon as a read succeeds.";
  }
}

/**
 * How much to trust a billed day's figure: whether it has already been
 * restated, and whether it may still be (ADR-128 §15).
 *
 * The two are orthogonal and the common case is BOTH — providers restate
 * inside the same 30 days the settling window covers — so they render as one
 * sentence rather than competing badges. Showing only one would either hide a
 * change that already happened or promise a finality nobody has given us.
 *
 * Null when the day is neither: an unmarked day is the quiet default, and a
 * note on every cell teaches a reader to stop seeing them.
 *
 * A revised day whose earlier figure cannot be stated in dollars says only
 * that it changed. Naming a number we withheld from the lane total two lines
 * up would be the partial figure that whole read side exists to refuse.
 */
/** "day" or "days", so the note below reads as a sentence either way. */
function days(count: number): string {
  return count === 1 ? "day" : "days";
}

/**
 * The window-level version of the same two facts, for a reader who has not
 * hovered any day.
 *
 * Counts rather than dates: the dates are on the days themselves, and a list
 * of them here would be a second place to keep in step with the first.
 */
export function restatementNote({
  revisedDays,
  provisionalDays,
}: {
  revisedDays: number;
  provisionalDays: number;
}): string {
  const clauses: string[] = [];
  if (revisedDays > 0) {
    clauses.push(
      `${revisedDays} ${days(revisedDays)} in this window ${
        revisedDays === 1 ? "has" : "have"
      } been revised by the provider since first reported`,
    );
  }
  if (provisionalDays > 0) {
    clauses.push(
      `${provisionalDays} ${days(
        provisionalDays,
      )} can still change while the provider settles ${
        provisionalDays === 1 ? "it" : "them"
      }`,
    );
  }
  return `${clauses.join(", and ")}. Hover a day to see which.`;
}

export function dayTrustNote({
  revised,
  previousUsd,
  provisional,
}: {
  revised: boolean;
  previousUsd: number | null;
  provisional: boolean;
}): string | null {
  if (!revised && !provisional) return null;
  const mayChange = "may still change";
  if (!revised) {
    return `This day ${mayChange} — the provider can still restate it.`;
  }
  const was =
    previousUsd === null
      ? "Revised since it was first reported"
      : `Revised, was ${formatLaneUsd(previousUsd)}`;
  return provisional ? `${was} — ${mayChange}.` : `${was}.`;
}
