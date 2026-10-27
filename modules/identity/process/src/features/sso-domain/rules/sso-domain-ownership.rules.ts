import {
  qualifySsoDomainOwnership,
  type SsoConnectionLifecycleState,
  type SsoConnectionState,
} from "@langwatch/identity-contract";

/** A connection in one of these is a tombstone: it owns nothing and holds no slot. */
export const SSO_CONNECTION_TERMINAL_STATES: readonly SsoConnectionLifecycleState[] = [
  "DISCARDED",
  "TORN_DOWN",
];

export function isTerminalSsoConnection(state: SsoConnectionLifecycleState): boolean {
  return SSO_CONNECTION_TERMINAL_STATES.includes(state);
}

/**
 * The proved domains a connection holds in the ownership table. A connection
 * that is gone owns nothing, so tearing one down releases its domains to the
 * next organization that proves them.
 */
export function ownedVerifiedDomains(state: SsoConnectionState): string[] {
  if (isTerminalSsoConnection(state.state)) return [];
  return state.verifiedDomains.filter(
    (domain) => qualifySsoDomainOwnership({ state, domain }).status !== "UNKNOWN",
  );
}

interface VerifiedDomainConnection {
  id: string;
  organizationId: string;
  replacesConnectionId: string | null;
}

/** Two connections may share one domain only as one organization's predecessor and replacement. */
export function verifiedDomainCanBeShared({
  existing,
  incoming,
}: {
  existing: VerifiedDomainConnection;
  incoming: VerifiedDomainConnection;
}): boolean {
  return (
    existing.organizationId === incoming.organizationId &&
    (incoming.replacesConnectionId === existing.id || existing.replacesConnectionId === incoming.id)
  );
}
