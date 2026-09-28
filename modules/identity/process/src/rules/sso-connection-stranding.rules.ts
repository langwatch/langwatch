import { looksLikeSsoConnectionId, type RoutableConnection } from "@langwatch/identity-contract";

import {
  identifierBelongsToMigrationConnection,
  type MigrationIdentifierBinding,
} from "./sso-migration.rules.ts";

type StrandingIdentifier = MigrationIdentifierBinding & Readonly<{ userId: string }>;
type TornDownConnection = Parameters<
  typeof identifierBelongsToMigrationConnection
>[0]["connection"];

/** The users whose live identifiers the connection being torn down holds. */
export function teardownCandidateUserIds({
  connection,
  candidates,
}: {
  connection: TornDownConnection;
  candidates: readonly StrandingIdentifier[];
}): string[] {
  return [
    ...new Set(
      candidates
        .filter((identifier) => identifierBelongsToMigrationConnection({ identifier, connection }))
        .map(({ userId }) => userId),
    ),
  ];
}

/**
 * The users a proved way in keeps once the connection goes: one it does not hold, through
 * no connection, or through one that exists and is ACTIVE. `routing` names every connection
 * the alternatives reference that exists.
 */
export function usersWithAnotherWayIn({
  connection,
  alternatives,
  routing,
}: {
  connection: TornDownConnection;
  alternatives: readonly StrandingIdentifier[];
  routing: ReadonlyMap<string, RoutableConnection["state"]>;
}): Set<string> {
  return new Set(
    alternatives
      .filter((identifier) => !identifierBelongsToMigrationConnection({ identifier, connection }))
      .filter(({ connectionId, providerId }) => {
        if (connectionId !== null && routing.get(connectionId) !== "ACTIVE") return false;
        if (
          providerId !== null &&
          looksLikeSsoConnectionId(providerId) &&
          !routing.has(providerId)
        ) {
          return false;
        }
        return (
          providerId !== connection.connectionId &&
          (providerId === null || !routing.has(providerId) || routing.get(providerId) === "ACTIVE")
        );
      })
      .map(({ userId }) => userId),
  );
}
