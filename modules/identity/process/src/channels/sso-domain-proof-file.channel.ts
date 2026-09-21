/**
 * What a fetch of the verification file found — the published proof's second
 * channel, with the TXT lookup's three answers and for the same reason: only
 * a clean not-found is the customer's to act on.
 */
export type SsoDomainFileFetch =
  /** The path answered, and these are the non-empty lines it served. */
  | { outcome: "served"; values: string[] }
  /** The domain answered plainly that nothing is at the path. */
  | { outcome: "absent" }
  /** The fetch itself failed. This says nothing about the domain. */
  | { outcome: "unreachable"; reason: string };

/**
 * Reading the verification file a customer serves. `url` is passed rather
 * than composed here, so the one place that decides where the file lives is
 * the identity vocabulary and not a channel.
 */
export interface SsoDomainProofFileChannel {
  fetchVerificationFile(args: { domain: string; url: string }): Promise<SsoDomainFileFetch>;
}
