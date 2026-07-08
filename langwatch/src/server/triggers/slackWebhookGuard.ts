import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";

/**
 * Single source of truth for the Slack incoming-webhook SSRF guard. Both the
 * outbox dispatch paths (`sendSlackWebhook`, `sendRenderedSlackMessage`) and the
 * test-fire path (`liveTriggerNotifier`) share this so the host allow-list can
 * never drift between copies.
 *
 * Stricter than the historical `startsWith("https://hooks.slack.com/")` and
 * `new URL(...).host === "hooks.slack.com"` checks: the URL must parse, use the
 * `https:` scheme, resolve to host EXACTLY `hooks.slack.com` (no userinfo prefix
 * like `https://x@hooks.slack.com/`, which the bare-host check accepted), and
 * carry a non-empty webhook path. This closes the `https://hooks.slack.com@evil`
 * and `https://hooks.slack.com.evil.com/` bypasses.
 */
const isGenuineSlackWebhookUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  // Reject any userinfo (`user:pass@`), which would otherwise let
  // `https://hooks.slack.com@evil.com/` masquerade as a Slack host.
  if (parsed.username !== "" || parsed.password !== "") return false;

  // Host must be exactly hooks.slack.com (optionally on the default 443 port).
  // `new URL` already lowercases the host, so case variants normalize here.
  const hostIsSlack =
    parsed.host === "hooks.slack.com" || parsed.host === "hooks.slack.com:443";
  if (!hostIsSlack) return false;

  // A genuine incoming webhook lives under /services/...; require at least a
  // non-empty path so the bare origin is not treated as a valid endpoint.
  if (parsed.pathname === "" || parsed.pathname === "/") return false;

  return true;
};

/**
 * Boolean predicate for the test-fire path: returns false (instead of throwing)
 * when the URL is not a genuine Slack incoming-webhook endpoint.
 */
export const isSlackWebhookUrl = (url: string): boolean =>
  isGenuineSlackWebhookUrl(url);

/**
 * Throws a non-retryable `DispatchError` when `url` is not a genuine Slack
 * incoming-webhook endpoint. A bad URL can never become valid on retry, so the
 * failure is classified non-retryable for the drainer.
 */
export const assertSlackWebhookUrl = (
  url: string,
  triggerName: string,
): void => {
  if (!isGenuineSlackWebhookUrl(url)) {
    throw new DispatchError({
      message: `Refusing to dispatch Slack webhook for trigger "${triggerName}": URL is not a genuine https://hooks.slack.com/ incoming-webhook endpoint`,
      retryable: false,
    });
  }
};
