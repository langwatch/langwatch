import {
  Currency,
  type Currency as CurrencyType,
  type CurrencyRequest,
} from "@langwatch/enterprise-billing-contract";
// @ts-expect-error — no type definitions for geoip-country
import geoip from "geoip-country";

const DEFAULT_CURRENCY = Currency.EUR;

export const EUR_COUNTRIES = new Set([
  "AT",
  "BE",
  "CY",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PT",
  "SK",
  "SI",
  "ES",
  "HR",
  "BG",
  "AD",
  "MC",
  "SM",
  "VA",
  "ME",
  "XK",
]);

export class CurrencyService {
  private constructor() {}

  static create(): CurrencyService {
    return new CurrencyService();
  }

  static fromCountry(countryCode: string | null | undefined): CurrencyType {
    return CurrencyService.currencyFromCountry(countryCode);
  }

  detect(request: CurrencyRequest | undefined): {
    currency: CurrencyType;
    country: string | null;
  } {
    return CurrencyService.detectCurrencyFromRequest(request);
  }

  private static currencyFromCountry(countryCode: string | null | undefined): CurrencyType {
    if (!countryCode) {
      return DEFAULT_CURRENCY;
    }

    return EUR_COUNTRIES.has(countryCode.toUpperCase()) ? Currency.EUR : Currency.USD;
  }

  private static is172Private(ip: string): boolean {
    const parts = ip.split(".");
    if (parts[0] !== "172") {
      return false;
    }

    const second = parseInt(parts[1] ?? "", 10);

    return second >= 16 && second <= 31;
  }

  private static isLocalIp(ip: string): boolean {
    return (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip.startsWith("192.168.") ||
      ip.startsWith("10.") ||
      CurrencyService.is172Private(ip) ||
      // IPv6-mapped loopback (::ffff:127.0.0.1)
      ip.includes("127.0.0.1")
    );
  }

  /**
   * Detect currency from a request using: CDN headers → geoip lookup → fallback.
   */
  private static detectCurrencyFromRequest(req: CurrencyRequest | undefined): {
    currency: CurrencyType;
    country: string | null;
  } {
    // 1. Try CDN-injected country headers
    const vercelCountry = req?.headers?.["x-vercel-ip-country"];
    const cfCountry = req?.headers?.["cf-ipcountry"];
    let headerCountry: string | null = null;
    if (typeof vercelCountry === "string") {
      headerCountry = vercelCountry;
    } else if (typeof cfCountry === "string") {
      headerCountry = cfCountry;
    }

    if (headerCountry) {
      return {
        currency: CurrencyService.currencyFromCountry(headerCountry),
        country: headerCountry,
      };
    }

    // 2. Geoip lookup on the address the door resolved; no address header is read here
    const ip = req?.callerAddress ?? null;

    if (!ip || CurrencyService.isLocalIp(ip)) {
      return { currency: DEFAULT_CURRENCY, country: null };
    }

    try {
      const geo = geoip.lookup(ip);
      if (geo?.country) {
        return {
          currency: CurrencyService.currencyFromCountry(geo.country),
          country: geo.country,
        };
      }
    } catch {
      // geoip lookup failed, fall through to default
    }

    // 3. Fallback
    return { currency: DEFAULT_CURRENCY, country: null };
  }
}
