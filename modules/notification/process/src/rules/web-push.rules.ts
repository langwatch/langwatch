/**
 * Web Push decisions, pure: which push services a browser may name, the topic header a
 * subject gets, and what a push service's answer means for the send.
 * Spec: modules/notification/specs/web-push.feature
 */
import { createHash } from "node:crypto";

/**
 * The browser push services: Chrome and Edge's FCM, Firefox's autopush, Safari's APNs
 * web push, and Windows' WNS. A subscription naming any other host is refused.
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
] as const;

export function isKnownPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/**
 * The `Topic` header for a subject: at most 32 URL-safe base64 characters (RFC 8030 §5.4),
 * so the subject is hashed rather than sent. One subject always maps to one topic.
 */
export function webPushTopicHeader(subject: string): string {
  return createHash("sha256").update(subject).digest("base64url").slice(0, 32);
}

/** What a push service's answer means for one send. */
type WebPushAnswer =
  | { outcome: "delivered" }
  | { outcome: "gone" }
  | { outcome: "retry"; retryAfterMs?: number }
  | { outcome: "refused" };

/**
 * 2xx delivered. 404 and 410 mean the browser's subscription expired or was revoked,
 * so the row goes. 429 and 5xx are worth another try, no sooner than the service asked.
 * Any other answer (a bad payload, a key the service rejects) does not change on retry.
 */
export function classifyWebPushAnswer(input: {
  status: number;
  retryAfterMs?: number;
}): WebPushAnswer {
  const { status } = input;
  if (status >= 200 && status < 300) return { outcome: "delivered" };
  if (status === 404 || status === 410) return { outcome: "gone" };
  if (status === 429 || (status >= 500 && status < 600)) {
    return input.retryAfterMs === undefined
      ? { outcome: "retry" }
      : { outcome: "retry", retryAfterMs: input.retryAfterMs };
  }
  return { outcome: "refused" };
}

/** What the VAPID `sub` claim is derived from. */
export interface VapidSettings {
  publicBaseUrl: string | undefined;
}

/** The contact the push services may reach when the installation has no https address. */
const FALLBACK_VAPID_SUBJECT = "https://langwatch.ai";

/** The `sub` claim: this installation's https origin, else the vendor's site. */
export function vapidSubject(settings: VapidSettings): string {
  if (settings.publicBaseUrl?.startsWith("https://")) {
    return new URL(settings.publicBaseUrl).origin;
  }
  return FALLBACK_VAPID_SUBJECT;
}
