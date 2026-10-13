// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationSsoConnection, SsoConnectionState } from "@langwatch/identity-contract";

/** A folded connection as SCIM reads it; the provider id is the name, as identity answers it. */
export function toOrganizationSsoConnection(state: SsoConnectionState): OrganizationSsoConnection {
  return {
    connectionId: state.connectionId,
    displayName: state.idpMetadata.providerId,
    providerId: state.idpMetadata.providerId,
    verifiedDomains: state.verifiedDomains,
    type: state.type,
    state: state.state,
    replacesConnectionId: state.replacesConnectionId,
    migrationPhase: state.migrationPhase,
  };
}
