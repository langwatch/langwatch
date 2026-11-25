import {
  qualifySsoDomainOwnership,
  type RoutableConnection,
  routingStateOf,
  type SsoConnectionState,
  ssoMigrationRouteOf,
} from "@langwatch/identity-contract";

const ROUTABLE_WHILE_PAIRED = new Set(["ACTIVE", "SUSPENDED"]);

/** The other half of a migrating pair, empty when this one is not in a pair. */
function partnersOf(
  connections: readonly SsoConnectionState[],
  connection: SsoConnectionState,
): SsoConnectionState[] {
  return connections.filter(
    (candidate) =>
      candidate.organizationId === connection.organizationId &&
      (candidate.connectionId === connection.replacesConnectionId ||
        candidate.replacesConnectionId === connection.connectionId),
  );
}

/**
 * Which side of a grandfathered/direct pair an ordinary sign-in goes through,
 * read from the persisted phase. Timestamps are deliberately absent: the same
 * facts must select the same side however the rows were touched.
 */
export function routedSsoConnections(
  connections: readonly SsoConnectionState[],
): SsoConnectionState[] {
  if (connections.length <= 1) return [...connections];

  const replacement = connections.find((connection) =>
    connections.some((candidate) => candidate.connectionId === connection.replacesConnectionId),
  );
  const predecessor = connections.find(
    (connection) => connection.connectionId === replacement?.replacesConnectionId,
  );
  if (
    replacement === undefined ||
    predecessor === undefined ||
    predecessor.organizationId !== replacement.organizationId ||
    connections.length !== 2
  ) {
    throw new Error("sso_domain_holders_are_not_a_replacement_pair");
  }

  if (replacement.migrationPhase === null) return [predecessor];

  return ssoMigrationRouteOf(replacement.migrationPhase) === "direct"
    ? [replacement]
    : [predecessor];
}

/**
 * Which side of this connection normal sign-in can be offered. A paired one
 * keeps the side the cutover routes to while it is ACTIVE or SUSPENDED; an
 * unpaired one only while ACTIVE, having no second side to fall back to.
 */
function routableSidesOf(
  connection: SsoConnectionState,
  partner: SsoConnectionState | undefined,
): SsoConnectionState[] {
  if (partner === undefined) return connection.state === "ACTIVE" ? [connection] : [];

  return routedSsoConnections([connection, partner]).filter((routed) =>
    ROUTABLE_WHILE_PAIRED.has(routed.state),
  );
}

/**
 * One connection per organization, a migrating pair collapsed to the side
 * normal sign-in goes through: offering both halves would present an
 * organization mid-cutover as two separate places to sign in.
 */
export function routableSsoConnections(
  connections: readonly SsoConnectionState[],
): SsoConnectionState[] {
  const paired = new Set<string>();
  const selected: SsoConnectionState[] = [];

  for (const connection of connections) {
    if (paired.has(connection.connectionId)) continue;

    const [partner] = partnersOf(connections, connection);
    if (partner !== undefined) {
      paired.add(connection.connectionId);
      paired.add(partner.connectionId);
    }

    selected.push(...routableSidesOf(connection, partner));
  }

  return selected;
}

/**
 * WHICH REGISTRY HOLDS THE PROVIDER IS WHICH ID GETS DIALED. A grandfathered
 * `providerId` pins the provider this deployment mounts (or an upstream
 * behind it); a self-serve one is keyed by its CONNECTION id.
 */
export function ssoRoutingMethodIdOf(connection: SsoConnectionState): string {
  return connection.source === "legacy-grandfathered"
    ? connection.idpMetadata.providerId
    : connection.connectionId;
}

/**
 * One projected connection as routing sees it. `domain` is how a lapse
 * reaches sign-in (ADR-123): it still routes and stops PROVISIONING. The
 * domainless caller is the sole-connection redirect, which provisions nobody.
 */
export function routableSsoConnectionOf({
  connection,
  dial,
  domain,
}: {
  connection: SsoConnectionState;
  /** The method this connection is actually dialed through, or null when
   *  none is - which is exactly what `configured` means. */
  dial: string | null;
  domain?: string;
}): RoutableConnection {
  return {
    connectionId: connection.connectionId,
    method: {
      id: dial ?? ssoRoutingMethodIdOf(connection),
      kind: "federated",
      connectionId: connection.connectionId,
    },
    state: routingStateOf(connection.state),
    configured: dial !== null,
    allowsJit:
      connection.arrivalPolicy !== "refuse" &&
      (domain === undefined ||
        qualifySsoDomainOwnership({ state: connection, domain }).status === "QUALIFIED"),
  };
}
