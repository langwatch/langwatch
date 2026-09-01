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
