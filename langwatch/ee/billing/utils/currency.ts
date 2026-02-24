import { Currency } from "@prisma/client";
import type { NextApiRequest } from "next";
// @ts-ignore — no type definitions for geoip-country
import geoip from "geoip-country";

const DEFAULT_CURRENCY = Currency.EUR;

export const EUR_COUNTRIES = new Set([
  "AT", "BE", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
  "HR", "BG", "AD", "MC", "SM", "VA", "ME", "XK",
]);

export const getCurrencyFromCountry = (countryCode: string | null | undefined): Currency => {
  if (!countryCode) return DEFAULT_CURRENCY;
  return EUR_COUNTRIES.has(countryCode.toUpperCase()) ? Currency.EUR : Currency.USD;
};

/**
 * Extract client IP from request headers.
 * Tries CDN/proxy headers in order of preference: CF, real-ip, forwarded-for.
 */
const getClientIp = (req: NextApiRequest | undefined): string | null => {
  if (!req?.headers) return null;

  const cfIp = req.headers["cf-connecting-ip"];
  if (cfIp) return Array.isArray(cfIp) ? cfIp[0]! : cfIp;

  const realIp = req.headers["x-real-ip"];
  if (realIp) return Array.isArray(realIp) ? realIp[0]! : realIp;

  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0]! : forwarded;
    return first.split(",")[0]!.trim();
  }

  return null;
};

const isLocalIp = (ip: string): boolean =>
  ip === "127.0.0.1" ||
  ip === "::1" ||
  ip.startsWith("192.168.") ||
  ip.startsWith("10.") ||
  ip.endsWith("127.0.0.1");

/**
 * Detect currency from a request using: CDN headers → geoip lookup → fallback.
 *
 * Resolution order:
 * 1. CDN-injected country headers (x-vercel-ip-country, cf-ipcountry)
 * 2. geoip-country lookup from client IP
 * 3. DEFAULT_CURRENCY fallback
 */
export const detectCurrencyFromRequest = (
  req: NextApiRequest | undefined,
): { currency: Currency; country: string | null } => {
  // 1. Try CDN-injected country headers
  const vercelCountry = req?.headers?.["x-vercel-ip-country"];
  const cfCountry = req?.headers?.["cf-ipcountry"];
  const headerCountry = (
    typeof vercelCountry === "string" ? vercelCountry :
    typeof cfCountry === "string" ? cfCountry :
    null
  );

  if (headerCountry) {
    return { currency: getCurrencyFromCountry(headerCountry), country: headerCountry };
  }

  // 2. Try geoip lookup from client IP
  const ip = getClientIp(req);

  if (!ip || isLocalIp(ip)) {
    return { currency: DEFAULT_CURRENCY, country: null };
  }

  try {
    const geo = geoip.lookup(ip);
    if (geo?.country) {
      return { currency: getCurrencyFromCountry(geo.country), country: geo.country };
    }
  } catch {
    // geoip lookup failed, fall through to default
  }

  // 3. Fallback
  return { currency: DEFAULT_CURRENCY, country: null };
};
