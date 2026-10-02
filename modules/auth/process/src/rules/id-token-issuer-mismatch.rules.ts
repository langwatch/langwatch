/**
 * Naming an ID token refused for its issuer. The engine answers the generic
 * `invalid_provider` / `token_not_verified`; only its logger sees jose's
 * `ERR_JWT_CLAIM_VALIDATION_FAILED` with `claim: "iss"` and the payload.
 */
import { z } from "zod";

const issuerRefusalSchema = z.object({
  code: z.literal("ERR_JWT_CLAIM_VALIDATION_FAILED"),
  claim: z.literal("iss"),
  payload: z.object({ iss: z.string().min(1) }),
});

/** The issuers an `iss` refusal among these logged values names. */
export function refusedIssuersIn(values: readonly unknown[]): string[] {
  return values.flatMap((value) => {
    const refusal = issuerRefusalSchema.safeParse(value);
    return refusal.success ? [refusal.data.payload.iss] : [];
  });
}

export type IssuerMismatchRedirect = { kind: "pass" } | { kind: "rewrite"; location: string };

/**
 * The engine's generic token refusal, rewritten to `sso_issuer_mismatch` with
 * both issuers. Any other redirect passes untouched; a relative `Location`
 * stays relative.
 */
export function issuerMismatchRedirectOf({
  location,
  received,
  expected,
}: {
  location: string | null;
  received: string;
  expected: string | undefined;
}): IssuerMismatchRedirect {
  if (!location) return { kind: "pass" };
  const absolute = /^https?:\/\//i.test(location);
  const target = parsedLocation(location);
  if (!target.parsed) return { kind: "pass" };
  const { url } = target;
  if (
    url.searchParams.get("error") !== "invalid_provider" ||
    url.searchParams.get("error_description") !== "token_not_verified"
  ) {
    return { kind: "pass" };
  }
  url.searchParams.set("error", "sso_issuer_mismatch");
  url.searchParams.delete("error_description");
  url.searchParams.set("received_issuer", received);
  if (expected !== undefined) url.searchParams.set("expected_issuer", expected);
  return {
    kind: "rewrite",
    location: absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`,
  };
}

function parsedLocation(location: string): { parsed: true; url: URL } | { parsed: false } {
  try {
    return { parsed: true, url: new URL(location, "http://relative.invalid") };
  } catch {
    return { parsed: false };
  }
}
