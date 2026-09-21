/**
 * Where a published proof lives and how long it stands (ADR-123, D05). One
 * name and one path for every organization: the VALUE is the secret, and a
 * per-organization label would publish a customer's identifier.
 */

/** How long a published record stays a proof. Seven days: room for a ticket
 *  with whoever runs their DNS, short enough that a token nobody used stops
 *  being one. */
export const SSO_DNS_PROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a domain whose record went missing keeps vouching for new people:
 * a weekend DNS migration survives it, a domain somebody else now owns
 * cannot admit strangers for a week. Only a DEFINITIVE absence advances it.
 */
export const SSO_DNS_REPROOF_GRACE_MS = 48 * 60 * 60 * 1000;

/** The label the record is published at. */
export const SSO_DNS_RECORD_NAME = "_langwatch-verification" as const;

/** Spelled out because a DNS control panel asks for it as its own field, and
 *  guessing is how people publish a CNAME. */
export const SSO_DNS_RECORD_TYPE = "TXT" as const;

/**
 * The whole name the record lives at, which is what a provider asks for when
 * it wants a fully qualified name. A dedicated label rather than the apex is
 * what lets the value be a bare token: nothing else publishes here.
 */
export function ssoDnsRecordName({ domain }: { domain: string }): string {
  return `${SSO_DNS_RECORD_NAME}.${domain}`;
}

/**
 * Where the domain serves the token when the customer chooses the file
 * channel: the same minted value, as the whole body of a plain-text file.
 * `https` is not a choice — plain HTTP could be answered by anybody.
 */
export const SSO_VERIFICATION_FILE_PATH = "/.well-known/langwatch-verification.txt" as const;

/** The whole address the check fetches, and what the setup screen shows. */
export function ssoVerificationFileUrl({ domain }: { domain: string }): string {
  return `https://${domain}${SSO_VERIFICATION_FILE_PATH}`;
}
