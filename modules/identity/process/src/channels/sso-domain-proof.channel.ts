/**
 * What a lookup at the verification name found. Three answers, not two:
 * "nothing is published" is the customer's to act on, "we could not find
 * out" is ours (specs/identity/sso-domain-verification.feature).
 */
export type SsoDomainTxtLookup =
  /** The name resolved, and these are the values published at it. */
  | { outcome: "published"; values: string[] }
  /** The name resolved to nothing: no such name, or no TXT record on it. */
  | { outcome: "absent" }
  /** The lookup itself failed. This says nothing about the domain. */
  | { outcome: "unreachable"; reason: string };

/**
 * Reading the record a customer published. `name` is passed rather than
 * composed here, so the one place that decides where the record lives is the
 * identity vocabulary and not a channel.
 */
export interface SsoDomainProofChannel {
  lookupTxtValues(args: { domain: string; name: string }): Promise<SsoDomainTxtLookup>;
}
