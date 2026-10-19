// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";

import type { ScimHeldConnections } from "../../services/scim-directory-identity.service.ts";

/**
 * The connections identity says an organization holds, as a double: every id
 * it is given is ACTIVE until a test moves it, and an id it was never given
 * is a connection the organization no longer holds.
 */
export class HeldConnectionsFake implements ScimHeldConnections {
  readonly held = new Map<string, OrganizationSsoConnection>();

  static of(connectionIds: readonly string[] = []): HeldConnectionsFake {
    const fake = new HeldConnectionsFake();
    for (const connectionId of connectionIds) fake.hold({ connectionId });
    return fake;
  }

  hold(connection: Partial<OrganizationSsoConnection> & { connectionId: string }): void {
    this.held.set(connection.connectionId, {
      displayName: connection.connectionId,
      providerId: connection.connectionId,
      verifiedDomains: [],
      type: "oidc",
      state: "ACTIVE",
      replacesConnectionId: null,
      migrationPhase: null,
      ...connection,
    });
  }

  async findHeldConnections(): Promise<OrganizationSsoConnection[]> {
    return [...this.held.values()];
  }
}
