// PostHog's client SDK logs its self-imposed rate-limit notices at
// console.error (e.g. "[PostHog.js] This capture call is ignored due to
// client rate limiting."). They aren't actionable — PostHog is just
// throttling itself — but at ERROR level they drown out real app errors
// in devtools (issue #3200). The SDK does not expose a public log-level
// hook, so we patch console.error once and re-emit matching lines via
// console.warn instead.
//
// Match is intentionally narrow: requires the "[PostHog.js]" prefix on
// the first stringifiable argument plus the literal phrase "rate limit"
// (case-insensitive). Non-matching console.error calls pass through
// untouched.

const POSTHOG_LOG_PREFIX = "[PostHog.js]";
const RATE_LIMIT_PHRASE = /rate limit/i;

let installed = false;

function isPosthogRateLimitMessage(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const first = args[0];
  if (typeof first !== "string") return false;
  if (!first.includes(POSTHOG_LOG_PREFIX)) return false;
  return args.some(
    (arg) => typeof arg === "string" && RATE_LIMIT_PHRASE.test(arg),
  );
}

export function installPosthogRateLimitLogDowngrade(): void {
  if (installed) return;
  if (typeof console === "undefined") return;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    if (isPosthogRateLimitMessage(args)) {
      originalWarn(...args);
      return;
    }
    originalError(...args);
  };

  installed = true;
}

// Test-only: allow unit tests to reset the singleton between cases.
export function __resetPosthogRateLimitLogDowngradeForTests(): void {
  installed = false;
}
