import { toEpochMs, type Instant, type TimeInput } from "@langwatch/time";

/**
 * A browser and a machine, named from the string the browser sent. Specific
 * names are matched before generic ones, since every Chromium browser also
 * says "Safari". Unplaced reads as unknown rather than as a guess.
 */

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdgA?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bBrave\//, "Brave"],
  [/\bVivaldi\//, "Vivaldi"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/\bAndroid\b/, "Android"],
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bWindows NT\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/** "Chrome on macOS", or just the browser when the string names no platform. */
export function browserSessionLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown browser";
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "Unknown browser";
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  return platform ? `${browser} on ${platform}` : browser;
}

/**
 * Two weeks, because activity is known only to the nearest day and a shorter
 * window would mark a browser somebody uses every Monday. A prompt to look,
 * never a verdict: an old session is not a compromised one.
 */
export const SESSION_STALE_AFTER_DAYS = 14;

export function isSessionStale({
  lastActiveAt,
  now,
}: {
  lastActiveAt: TimeInput;
  now: Instant;
}): boolean {
  const idleDays = (now.epochMilliseconds - toEpochMs(lastActiveAt)) / 86_400_000;

  return idleDays >= SESSION_STALE_AFTER_DAYS;
}
