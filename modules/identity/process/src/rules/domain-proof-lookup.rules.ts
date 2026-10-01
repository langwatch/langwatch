import type { SsoDomainTxtLookup } from "../channels/sso-domain-proof.channel.ts";

/**
 * "No such name" and "no TXT record on it" are the resolver saying the record
 * is absent — the customer's to act on. SERVFAIL, a refusal, a timeout or a
 * malformed answer are the lookup failing to happen, which is ours.
 */
const ABSENT_DNS_CODES = new Set(["ENOTFOUND", "ENODATA", "NOTFOUND", "NODATA"]);

/** Which of the two failing answers a thrown resolver error is. */
export function classifyDnsLookupFailure(
  error: unknown,
): Extract<SsoDomainTxtLookup, { outcome: "absent" | "unreachable" }> {
  const code =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;
  if (code !== null && ABSENT_DNS_CODES.has(code)) return { outcome: "absent" };

  return { outcome: "unreachable", reason: code ?? "lookup_failed" };
}
