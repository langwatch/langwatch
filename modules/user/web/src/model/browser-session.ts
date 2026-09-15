/**
 * A browser and a machine, named from the string the browser sent. Specific
 * names are matched before generic ones, since every Chromium browser also
 * says "Safari". Unplaced reads as unknown rather than as a guess.
 */

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdgA?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
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
  [/\bLinux\b/, "Linux"],
];

/** "Chrome on macOS", or just the browser when the string names no platform. */
export function browserSessionLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown browser";
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "Unknown browser";
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  return platform ? `${browser} on ${platform}` : browser;
}
