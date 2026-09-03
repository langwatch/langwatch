import type { GovernanceAzureBillingNote } from "@ee/governance/services/azureBillingNote";

import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";

/**
 * A cost lane's amount, or an em dash when no figure is held.
 *
 * Every digit decision is delegated to `formatBudgetUsd`; this only moves the
 * sign. That function's magnitude branches all test `>=`, so a negative falls
 * through to the six-decimal tail and renders as `$-12.5`. A refund-heavy
 * billed day is a real case on this screen, and `-$12.50` is the same number
 * read the way a bill reads it.
 *
 * Null stays null all the way to the string: `formatBudgetUsd` answers an em
 * dash, never `$0.00`. A zero here would be a claim that nothing was spent.
 */
export function formatLaneUsd(amountUsd: number | null): string {
  if (amountUsd === null || amountUsd >= 0) return formatBudgetUsd(amountUsd);
  return `-${formatBudgetUsd(Math.abs(amountUsd))}`;
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
