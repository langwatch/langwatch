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

/**
 * What one re-proof sweep did (ADR-123), for the worker's log line and for a
 * test to assert on without reading a ledger.
 */
export interface SsoDomainReproofOutcome {
  /** Whether the batch filled, so more domains wait for the next cycle. */
  truncated: boolean;
  checked: number;
  wavered: number;
  lapsed: number;
  recovered: number;
  /** Lookups that could not be answered. Counted rather than acted on. */
  unreachable: number;
  /** Domains whose re-read threw, carried out so the worker says it once. */
  failed: { domain: string; error: unknown }[];
}

/** The administrator running the ceremony, as the surface knows them. */
export interface SelfServeActor {
  userId: string;
}

/**
 * Where one domain's proof goes, in every spelling a control panel asks for.
 * Composed from the vocabulary above, so the name shown to a customer and the
 * name the lookup asks for cannot drift apart.
 */
export interface SelfServeDnsRecordLocation {
  domain: string;
  label: string;
  name: string;
  type: typeof SSO_DNS_RECORD_TYPE;
  file: { path: string; url: string };
}

/** A location plus the token to publish there. Answered ONCE: the fact keeps
 *  only the hash, so a lost value is replaced, never read back out of us. */
export interface SelfServeIssuedDnsRecord extends SelfServeDnsRecordLocation {
  value: string;
  expiresAtMs: number;
}

/** Every location one domain's proof can take. */
export function ssoDomainRecordLocation({
  domain,
}: {
  domain: string;
}): SelfServeDnsRecordLocation {
  return {
    domain,
    label: SSO_DNS_RECORD_NAME,
    name: ssoDnsRecordName({ domain }),
    type: SSO_DNS_RECORD_TYPE,
    file: { path: SSO_VERIFICATION_FILE_PATH, url: ssoVerificationFileUrl({ domain }) },
  };
}
