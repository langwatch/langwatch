/**
 * Failures that say nothing about the screen under capture. The join offer is
 * throttled per user per hour, and a run loads more pages than the allowance;
 * the limit is a product constant with no config, so its 429 is noise here.
 */
const THROTTLED_PATTERN = /\/api\/trpc\/[^?]*\bjoinRequests\.offer\b/;

export const isExpectedThrottle = ({ url, status }: { url: string; status: number }): boolean =>
  status === 429 && THROTTLED_PATTERN.test(url);

/** isThrottleConsoleError is the browser's own console line for an expected throttle. */
export const isThrottleConsoleError = ({ text, url }: { text: string; url: string }): boolean =>
  text.startsWith("Failed to load resource") &&
  /\b429\b/.test(text) &&
  isExpectedThrottle({ url, status: 429 });
