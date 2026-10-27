// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { emptySsoConnection, type OrganizationSsoConnection } from "@langwatch/identity-contract";

import type { ScimSsoConnectionFoldState } from "../../eventing/scim-sso-connection.projection.ts";
import type { ScimConnectionReads } from "../../services/scim-connections.service.ts";

/** A connection as SCIM's fold would hold it, for a test that states the connection as identity reads it. */
export function foldedConnectionOf({
  connection,
  organizationId,
}: {
  connection: OrganizationSsoConnection;
  organizationId: string;
}): ScimSsoConnectionFoldState {
  const empty = emptySsoConnection({ connectionId: connection.connectionId });
  return {
    ...empty,
    organizationId,
    type: connection.type,
    state: connection.state,
    verifiedDomains: connection.verifiedDomains,
    idpMetadata: { ...empty.idpMetadata, providerId: connection.providerId },
    replacesConnectionId: connection.replacesConnectionId,
    migrationPhase: connection.migrationPhase,
    LastEventOccurredAt: 0,
  };
}

/** SCIM's folded connections as a double answering the same list for every organization. */
export function foldedConnectionReads(
  connections: readonly OrganizationSsoConnection[],
): ScimConnectionReads {
  return {
    findForOrganization: ({ organizationId }) =>
      Promise.resolve(
        connections.map((connection) => foldedConnectionOf({ connection, organizationId })),
      ),
  };
}
