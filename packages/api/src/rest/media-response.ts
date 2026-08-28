/**
 * Shared HTTP hardening for routes that stream stored-object bytes back to a
 * browser (`/api/files`, `/api/user-avatar`). Centralised so every byte-serving
 * surface applies the exact same Content-Type coercion + security headers —
 * widening the allowlist or tightening the headers updates all of them at once.
 */
import { isReadbackSafe } from "@langwatch/stored-object-contract";

/**
 * Static response headers attached to every stored-object read. Never vary by
 * row, never echo user content: a locked-down CSP + sandbox + nosniff so a
 * stored payload can't be interpreted as active content, and no referrer leak.
 */
export const STORED_OBJECT_RESPONSE_BASE_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
};

/**
 * Resolves the Content-Type for a stored-object response: the requested type
 * when it is in the shared readback-safe allowlist (see `@langwatch/stored-object-contract`),
 * otherwise `application/octet-stream` to neutralize MIME sniffing and
 * stored-XSS primitives.
 */
export function safeMediaType(mediaType: string): string {
  return isReadbackSafe(mediaType) ? mediaType : "application/octet-stream";
}

/**
 * RFC 6266 — keep ASCII filename-safe characters, replace anything else with
 * `_`, and cap length. Used to build a header-injection-safe
 * `Content-Disposition` filename from an untrusted segment.
 */
export function sanitizeFilenameSegment(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}

/** A JSON response carrying the shared stored-object hardening headers. */
export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
    },
  });
}

/**
 * A 429 response with a `Retry-After` derived from the rate-limit reset time
 * (clamped to ≥ 1s), plus the shared hardening headers.
 */
export function rateLimitedResponse(resetAtMs: number): Response {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000))),
      ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
    },
  });
}
