/**
 * The line beneath a ranked token count — a department's or a person's:
 * what they spent, and what that figure covers.
 *
 * "Per-request cost" rather than "spend", because a subscription department's
 * zero is not a cheap department — it is a department whose bill arrives
 * somewhere this panel does not read. The estimate marker sits here rather
 * than beside the count so the lead figure stays one thing a reader compares
 * rows by. Spec: specs/governance/governance-cost-screen.feature, "The
 * department panel keeps its dollar figure as a second line".
 *
 * Shared by both token panels deliberately: they rank different things off
 * the same traces, and a reader comparing the two should not have to work out
 * whether two differently-worded second lines mean the same money.
 *
 * ITS OWN MODULE rather than a helper inside the page, because the SAMPLE
 * token rows have to say the same sentence. A sample row without this line
 * draws `CostRankList`'s one-line shape while a measured row draws the
 * two-line one, so sample mode would teach a layout the real screen never
 * shows — the one thing sample data is not allowed to do.
 */
import { formatLaneUsd } from "../costLaneFormat";

export function tokenRowSecondaryLine(row: {
  spendUsd: string;
  hasEstimatedTokens: boolean;
}): string {
  // The screen's own lane formatter, not the compact one the ranked figures
  // use: this line is an exact amount read beside a count, and `$310.5` next
  // to `4.1m tokens` reads as a truncated number rather than a price.
  const money = `${formatLaneUsd(Number(row.spendUsd))} per-request cost`;
  return row.hasEstimatedTokens ? `${money} · tokens estimated` : money;
}
