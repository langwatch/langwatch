import numeral from "numeral";
import type { Money } from "./types";

export const formatMoney = (money: Money, format = "$0.00[00]"): string => {
  const currencySymbols = {
    USD: "$",
    EUR: "€",
  };

  const formatted = numeral(money.amount ?? 0).format(format);

  const minimumAmount = format.replace(/[\$\[\]]/g, "").replace(/0$/, "1");
  if (
    formatted === "$0.00" &&
    money.amount < parseFloat(minimumAmount) &&
    money.amount > 0
  ) {
    return `< ${currencySymbols[money.currency ?? "USD"]}${minimumAmount}`;
  }

  if (money.amount > 1) {
    return numeral(money.amount ?? 0)
      .format("$0.00")
      .replace("$", currencySymbols[money.currency ?? "USD"]);
  }

  return formatted.replace("$", currencySymbols[money.currency ?? "USD"]);
};
