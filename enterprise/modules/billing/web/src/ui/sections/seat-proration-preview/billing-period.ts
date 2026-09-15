/**
 * The billing period, spelled out next to an amount the customer is about to
 * confirm.
 *
 * Every period the payment provider can report gets its own words. Collapsing
 * the unknown ones to "per month" would put a wrong period beside a real
 * charge, so an unrecognised one says nothing rather than something false.
 */
export function formatBillingPeriod(interval: string): string {
  switch (interval) {
    case "year":
      return " per year";
    case "month":
      return " per month";
    case "week":
      return " per week";
    case "day":
      return " per day";
    default:
      return "";
  }
}
