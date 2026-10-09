/**
 * A browser and a machine, named from the string the browser sent.
 *
 * A session list that says only "Signed in three days ago" cannot answer the
 * question people open it with, which is "is one of these not me". A browser
 * and an operating system are what somebody actually recognises about the
 * laptop they left at the office.
 *
 * DELIBERATELY SMALL. No user-agent library: the strings we need to tell apart
 * are the handful of desktop and mobile browsers our customers sign in with,
 * and a library that also knows about set-top boxes is a dependency and a
 * supply chain for an answer this narrow. Anything unrecognised reads as
 * "Unknown browser" rather than as a wrong guess.
 *
 * ORDER MATTERS. Every Chromium browser says "Chrome" and most say "Safari"
 * too, so the specific names are tested before the generic ones. The same
 * holds for the platforms: an Android user-agent also contains "Linux".
 *
 * Spec: specs/settings/profile.feature
 */

/** What we can tell about the thing a session was signed in from. */
export interface UserAgentLabel {
  /** For example "Chrome", or "Unknown browser". */
  browser: string;
  /** For example "macOS", or null when the string does not say. */
  platform: string | null;
}

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
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

const PLATFORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAndroid\b/, "Android"],
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bWindows NT\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/** What a stored user-agent string says, as far as we are willing to claim. */
export function describeUserAgent(
  userAgent: string | null | undefined,
): UserAgentLabel {
  if (!userAgent) return { browser: "Unknown browser", platform: null };

  const browser =
    BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ??
    "Unknown browser";
  const platform =
    PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

  return { browser, platform };
}

/** The same thing as one line: "Chrome on macOS". */
export function userAgentLabel(userAgent: string | null | undefined): string {
  const { browser, platform } = describeUserAgent(userAgent);
  return platform ? `${browser} on ${platform}` : browser;
}

/**
 * How long a session may go unused before the list says so.
 *
 * Two weeks, because activity is only known to the nearest day and a shorter
 * window would mark a browser somebody uses every Monday. The chip is a
 * prompt to look, never a verdict: an old session is not a compromised one.
 */
export const SESSION_STALE_AFTER_DAYS = 14;

/** Whether a session has gone quiet long enough to be worth pointing at. */
export function isSessionStale({
  lastActiveAt,
  now,
}: {
  lastActiveAt: Date;
  now: Date;
}): boolean {
  const days = (now.getTime() - lastActiveAt.getTime()) / 86_400_000;
  return days >= SESSION_STALE_AFTER_DAYS;
}
