// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";

/** A connection in these states no longer holds the people its directory provisioned. */
const RELEASED_STATES: ReadonlySet<string> = new Set([
  "DISCARDED",
  "TEARDOWN_PENDING",
  "TORN_DOWN",
]);

/** A replacement at these phases has taken its predecessor's people over, as on main. */
const SUCCEEDING_PHASES: ReadonlySet<string> = new Set(["FINALIZING", "FINALIZED"]);

/** The connection this one is finalizing a replacement of, whose people it inherits: none or one. */
export function findSucceededConnections({
  connections,
  connectionId,
}: {
  connections: readonly OrganizationSsoConnection[];
  connectionId: string;
}): string[] {
  return connections.flatMap((held) =>
    held.connectionId === connectionId &&
    held.replacesConnectionId !== null &&
    held.migrationPhase !== null &&
    SUCCEEDING_PHASES.has(held.migrationPhase)
      ? [held.replacesConnectionId]
      : [],
  );
}

/**
 * The claims that still keep `connectionId` out: a claim by a connection the
 * organization no longer holds, by one being retired, or by the predecessor
 * `connectionId` is succeeding, releases the person.
 */
export function standingClaimsAgainst({
  connections,
  connectionId,
  claims,
}: {
  connections: readonly OrganizationSsoConnection[];
  connectionId: string;
  claims: readonly string[];
}): string[] {
  const succeeded = findSucceededConnections({ connections, connectionId });
  return connections
    .filter(
      (held) =>
        claims.includes(held.connectionId) &&
        held.connectionId !== connectionId &&
        !succeeded.includes(held.connectionId) &&
        !RELEASED_STATES.has(held.state),
    )
    .map((held) => held.connectionId);
}
