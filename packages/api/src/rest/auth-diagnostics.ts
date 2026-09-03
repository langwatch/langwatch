/**
 * The fingerprint every credential refusal on this boundary is logged with.
 *
 * A 401 on an ingestion hot path is reported by the customer as "my SDK stopped
 * working", and the one thing on-call needs is which caller and which SDK. None
 * of these fields is a credential: the token never appears, only the shape of
 * the request that carried it.
 *
 * `hasEmptyAuthToken` distinguishes "X-Auth-Token sent as an empty string" — a
 * customer-side environment misconfiguration, where an SDK with an empty
 * `api_key` still serialises the header — from "no auth header at all", which
 * is a misconfigured SDK or an unauthenticated probe. Both answer the same 401;
 * the log line is the only place they are told apart.
 *
 * Declared over the three request members it reads rather than over `Context`,
 * so a test can hand it a literal and a family that has only a `Request` can
 * adapt one in three lines.
 */
export type AuthDiagnostics = {
  path: string;
  method: string;
  userAgent: string | null;
  traceparent: string | null;
  forwardedFor: string | null;
  hasEmptyAuthToken: boolean;
};

export function collectAuthDiagnostics(request: {
  path: string;
  method: string;
  header: (name: string) => string | undefined;
}): AuthDiagnostics {
  const get = (name: string) => request.header(name) ?? null;
  const xAuthToken = request.header("x-auth-token");
  return {
    path: request.path,
    method: request.method,
    userAgent: get("user-agent"),
    traceparent: get("traceparent"),
    forwardedFor: get("x-forwarded-for") ?? get("x-real-ip"),
    hasEmptyAuthToken: xAuthToken !== undefined && xAuthToken === "",
  };
}
