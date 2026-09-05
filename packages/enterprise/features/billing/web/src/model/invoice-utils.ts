/**
 * Pure utility functions for invoice display.
 *
 * Extracted from InvoicesBlock for testability.
 */

/**
 * Maps a Stripe invoice status to a Chakra UI color palette name.
 */
export function getInvoiceStatusColor(status: string): string {
  switch (status) {
    case "paid":
      return "green";
    case "open":
      return "yellow";
    case "void":
    case "uncollectible":
      return "red";
    default:
      return "gray";
  }
}

/**
 * Formats a unix timestamp into a human-readable date string.
 */
export function formatInvoiceDate(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats an amount in cents to a currency string.
 */
export function formatInvoiceAmount({
  amountCents,
  currency,
}: {
  amountCents: number;
  currency: string;
}): string {
  const amount = amountCents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount);
}
