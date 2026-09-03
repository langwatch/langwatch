import numeral from "numeral";

/** An amount with the currency it is in. */
export type Money = {
  amount: number;
  currency?: "USD" | "EUR";
};

/**
 * Money, written the way a cost line should read.
 *
 * `platform/app`'s `formatMoney`, unchanged: the "< $0.0001" branch is what
 * keeps a real but tiny spend from rendering as a flat zero, which reads as
 * "this cost nothing" rather than "this cost less than we show".
 */
export const formatMoney = (money: Money, format = "$0.00[00]"): string => {
  const currencySymbols = { USD: "$", EUR: "€" } as const;

  const formatted = numeral(money.amount ?? 0).format(format);

  const minimumAmount = format.replace(/[$[\]]/g, "").replace(/0$/, "1");
  if (formatted === "$0.00" && money.amount < parseFloat(minimumAmount) && money.amount > 0) {
    return `< ${currencySymbols[money.currency ?? "USD"]}${minimumAmount}`;
  }

  if (money.amount > 1) {
    return numeral(money.amount ?? 0)
      .format("$0.00")
      .replace("$", currencySymbols[money.currency ?? "USD"]);
  }

  return formatted.replace("$", currencySymbols[money.currency ?? "USD"]);
};
