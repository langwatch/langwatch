import numeral from "numeral";
import type { Money } from "./types";

export const formatMoney = (money: Money, format = "$0.00[00]"): string => {
  const currencySymbols = {
    USD: "$",
    EUR: "€",
  };

  if (money.amount < 0.0001 && money.amount > 0) {
    return `< ${currencySymbols[money.currency ?? "USD"]}0.0001`;
  }

  return numeral(money.amount ?? 0)
    .format(format)
    .replace("$", currencySymbols[money.currency ?? "USD"]);
};
