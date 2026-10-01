/**
 * The billing period, spelled out next to an amount the customer is about
 * to confirm. Every provider period gets its own words; an unrecognised
 * one says nothing rather than showing a wrong period as "per month".
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
