export type Currency = "EUR" | "USD";

export const EUR_COUNTRIES = new Set([
  "AT", "BE", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
  "HR", "AD", "MC", "SM", "VA", "ME", "XK",
]);

export const getCurrencyFromCountry = (countryCode: string | null | undefined): Currency => {
  if (!countryCode) return "USD";
  return EUR_COUNTRIES.has(countryCode.toUpperCase()) ? "EUR" : "USD";
};
