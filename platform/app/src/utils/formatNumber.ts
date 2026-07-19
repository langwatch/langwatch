import numeral from "numeral";

export function formatNumber(value: number, format = "0,0"): string {
  return numeral(value).format(format);
}

export function formatPercent(value: number, format = "0%"): string {
  return numeral(value).format(format);
}
