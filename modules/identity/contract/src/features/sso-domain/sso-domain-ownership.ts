import { normalizeDomain } from "../../identifier.ts";
import {
  isSsoPublishedProofChannel,
  type SsoConnectionLifecycleState,
  type SsoConnectionSource,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "../sso-connection/connection.ts";

/** The five states a connection passes through on its way to deciding
 *  sign-ins. A state not named here — including one added later — is not a
 *  setup in progress, so the person stays on the ordinary path. */
const SSO_CONNECTION_SETUP_STATES: readonly SsoConnectionLifecycleState[] = [
  "DRAFT",
  "CLAIMED",
  "APPROVED",
  "VERIFICATION_PENDING",
  "VERIFIED",
];

const SETUP_STATE_SET = new Set<string>(SSO_CONNECTION_SETUP_STATES);

/** Whether a connection is still being set up, as opposed to live, refused,
 *  suspended or gone. */
export function isSsoConnectionInSetup(state: string): boolean {
  return SETUP_STATE_SET.has(state);
}

/**
 * Whether a value names a connection at all. The environment prefixes ksuids
 * (`local_ssoc_…`) and `ssocmd_` is a different form, so the underscore on
 * both sides is load-bearing.
 */
export function looksLikeSsoConnectionId(value: string): boolean {
  return /(?:^|_)ssoc_/.test(value);
}

/** Whether this connection is the configured legacy compatibility route. */
export function isConfiguredLegacySsoRoute(state: {
  source: SsoConnectionSource;
  providerId: string;
}): boolean {
  return state.source === "legacy-grandfathered" && state.providerId.length > 0;
}

/** A connection the legacy pin's domain may still move onto: neither discarded nor torn down. */
const SSO_CONNECTION_GONE_STATES = new Set<string>(["DISCARDED", "TORN_DOWN"]);

/**
 * The legacy pin's domain still to move onto the organization's own connection (ADR-124 §7):
 * the pin set, no grandfathered connection, and a live one of its own that has not verified it.
 * Empty otherwise. Read off durable state, so it empties once the domain moves.
 */
export function legacySsoDomainsToMove({
  legacySsoDomain,
  connections,
}: {
  legacySsoDomain: string | undefined;
  connections: readonly { source: string; state: string; verifiedDomains: readonly string[] }[];
}): string[] {
  if (!legacySsoDomain) return [];
  if (connections.some((held) => held.source === "legacy-grandfathered")) return [];
  const live = connections.filter((held) => !SSO_CONNECTION_GONE_STATES.has(held.state));
  const domain = normalizeDomain(legacySsoDomain);
  if (live.length === 0 || live.some((held) => held.verifiedDomains.includes(domain))) return [];
  return [domain];
}

/** The domains whose evidence went missing and stayed missing (ADR-123). */
export function lapsedDomainsOf(state: Pick<SsoConnectionState, "domainVerifications">): string[] {
  return state.domainVerifications
    .filter((entry) => entry.proofState === "LAPSED")
    .map((entry) => entry.domain);
}

export type SsoDomainOwnershipQualification =
  | { status: "QUALIFIED"; proof: SsoDomainVerification }
  | { status: "UNKNOWN"; reason: "absent" | "inferred" | "incomplete" }
  | { status: "LAPSED"; proof: SsoDomainVerification };

/** The connection facts the qualification is read off. */
export type QualifiableConnection = Pick<
  SsoConnectionState,
  "verifiedDomains" | "domainVerifications" | "source" | "organizationId" | "replacesConnectionId"
>;

/**
 * The connection the grandfather migration creates for an organization, derived
 * from it so every pass names the same aggregate and only it can hold the import.
 */
export function grandfatheredSsoConnectionId({
  organizationId,
}: {
  organizationId: string;
}): string {
  return `ssoc_gf_${organizationId}`;
}

/** The one qualification used wherever domain control grants authority.
 *  `verifiedDomains` is routing history, not evidence: each method keeps what
 *  proved it, and nothing missing is ever inferred back into place. */
export function qualifySsoDomainOwnership({
  state,
  domain,
}: {
  state: QualifiableConnection;
  domain: string;
}): SsoDomainOwnershipQualification {
  if (!state.verifiedDomains.includes(domain)) return { status: "UNKNOWN", reason: "absent" };

  const proof = state.domainVerifications.find((entry) => entry.domain === domain);
  if (!proof) return { status: "UNKNOWN", reason: "absent" };
  if (proof.proofState === "LAPSED") return { status: "LAPSED", proof };
  if (proof.verifiedAtMs <= 0) return { status: "UNKNOWN", reason: "incomplete" };

  const completeness = proofCompleteness({ proof, state });
  if (completeness === "complete") return { status: "QUALIFIED", proof };
  return { status: "UNKNOWN", reason: completeness };
}

/** Whether a proof carries what its method needs; "inferred" for a method nothing records. */
function proofCompleteness({
  proof,
  state,
}: {
  proof: SsoDomainVerification;
  state: QualifiableConnection;
}): "complete" | "incomplete" | "inferred" {
  if (isSsoPublishedProofChannel(proof.method)) return completeWhen(Boolean(proof.tokenHash));
  if (proof.method === "operator-attested") return completeWhen(proof.actorId !== null);
  // A self-hosted installation's licence, recorded by the person who claimed the
  // domain; the guards state it only where the licence speaks for that person.
  if (proof.method === "license-token") {
    return completeWhen(Boolean(proof.evidenceRef) && proof.actorId !== null);
  }
  // The one-time import stands in for an operator nobody asked, so a named person
  // on it did not come from the migration. A replacement holds it only as inherited
  // from the grandfathered connection it names, as main checks the predecessor.
  if (proof.method === "legacy-configuration") {
    return completeWhen(proof.actorId === null && holdsTheLegacyImport(state));
  }
  return "inferred";
}

function holdsTheLegacyImport(state: QualifiableConnection): boolean {
  if (state.source === "legacy-grandfathered") return true;
  return (
    state.replacesConnectionId !== null &&
    state.replacesConnectionId ===
      grandfatheredSsoConnectionId({ organizationId: state.organizationId })
  );
}

function completeWhen(holds: boolean): "complete" | "incomplete" {
  return holds ? "complete" : "incomplete";
}

/**
 * What one connection's state says about one domain — three facts rather than
 * one verdict, because ADR-123 says a lapsed domain still ROUTES (people
 * already there keep signing in) and stops PROVISIONING (it admits nobody).
 */
export function ssoDomainStanding({
  connection,
  domain,
}: {
  connection: QualifiableConnection & Pick<SsoConnectionState, "state">;
  domain: string;
}): { live: boolean; proved: boolean; lapsed: boolean } {
  return {
    live: connection.state === "ACTIVE",
    proved: qualifySsoDomainOwnership({ state: connection, domain }).status === "QUALIFIED",
    lapsed: lapsedDomainsOf(connection).includes(domain),
  };
}

/**
 * Whether this domain still vouches for somebody NEW (ADR-123). Deliberately
 * says nothing about signing IN: everybody already here keeps their way in
 * whatever this answers.
 */
export function ssoDomainVouchesForNewPeople({
  state,
  domain,
}: {
  state: QualifiableConnection;
  domain: string;
}): boolean {
  return qualifySsoDomainOwnership({ state, domain }).status === "QUALIFIED";
}
