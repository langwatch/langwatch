import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Naming an ID token refused for its issuer.
 *
 * The SSO engine checks an ID token's `iss` against the connection's issuer
 * exactly, and on a mismatch answers `invalid_provider` /
 * `token_not_verified`, the same answer as for a bad signature or an expired
 * token. The cause only reaches its logger, as jose's
 * `ERR_JWT_CLAIM_VALIDATION_FAILED` with `claim: "iss"` and the token's
 * payload. This keeps the issuer that logger saw for the request, so the
 * redirect can carry `sso_issuer_mismatch` with both issuers instead of a
 * generic refusal.
 */

const scope = new AsyncLocalStorage<{ received: string | null }>();

/** Opens the per-request slot the logger writes into. */
export function runWithIdTokenIssuerScope<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({ received: null }, fn);
}

/** Reads what better-auth logged, and keeps an `iss` refusal's issuer. */
export function noteIdTokenIssuerRefusal(values: readonly unknown[]): void {
  const slot = scope.getStore();
  if (!slot) return;
  for (const value of values) {
    const received = refusedIssuerOf(value);
    if (received !== null) {
      slot.received = received;
      return;
    }
  }
}

function refusedIssuerOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as {
    code?: unknown;
    claim?: unknown;
    payload?: { iss?: unknown };
  };
  if (
    record.code !== "ERR_JWT_CLAIM_VALIDATION_FAILED" ||
    record.claim !== "iss"
  ) {
    return null;
  }
  const issuer = record.payload?.iss;
  return typeof issuer === "string" && issuer.length > 0 ? issuer : null;
}

/**
 * The redirect, carrying `sso_issuer_mismatch` and both issuers, when the
 * engine refused this request's ID token for its issuer. Anything else
 * passes through untouched.
 */
export async function nameIssuerMismatch({
  response,
  expectedIssuer,
}: {
  response: Response;
  /** The issuer the connection this callback belongs to holds. */
  expectedIssuer: () => Promise<string | null>;
}): Promise<Response> {
  const received = scope.getStore()?.received ?? null;
  if (received === null) return response;
  const location = response.headers.get("location");
  if (!location) return response;
  const absolute = /^https?:\/\//i.test(location);
  let target: URL;
  try {
    target = new URL(location, "http://relative.invalid");
  } catch {
    return response;
  }
  if (
    target.searchParams.get("error") !== "invalid_provider" ||
    target.searchParams.get("error_description") !== "token_not_verified"
  ) {
    return response;
  }
  const expected = await expectedIssuer();
  target.searchParams.set("error", "sso_issuer_mismatch");
  target.searchParams.delete("error_description");
  target.searchParams.set("received_issuer", received);
  if (expected !== null) target.searchParams.set("expected_issuer", expected);
  const headers = new Headers(response.headers);
  headers.set(
    "location",
    absolute
      ? target.toString()
      : `${target.pathname}${target.search}${target.hash}`,
  );
  return new Response(response.body, { status: response.status, headers });
}
