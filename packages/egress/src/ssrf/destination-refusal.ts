/**
 * Why the address policy refused a destination. A caller explains the refusal by this, never by
 * the message: `on_premise_domain` and `private_address` are the two an operator can lift with
 * ALLOWED_PROXY_HOSTS; `metadata_endpoint` and `cloud_internal_domain` no setting lifts.
 */
export type EgressRefusalReason =
  | "metadata_endpoint"
  | "cloud_internal_domain"
  | "on_premise_domain"
  | "private_address"
  | "unresolvable_host"
  | "invalid_url";

/** The destination was refused by the address policy before any request was sent. */
export class EgressDestinationRefusedError extends Error {
  constructor(
    readonly reason: EgressRefusalReason,
    message: string,
  ) {
    super(message);
    this.name = "EgressDestinationRefusedError";
  }
}

/** The refusal reason when the error is a policy refusal, else undefined. */
export function egressRefusalReason(error: unknown): EgressRefusalReason | undefined {
  return error instanceof EgressDestinationRefusedError ? error.reason : undefined;
}
