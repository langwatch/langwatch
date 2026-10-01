// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A provisioning token reaches no further than the life of the connection it
 * was issued against (D08). Identity states that lifecycle and counts no
 * token of ours, so the retirement is this module's own: a credential naming
 * a connection the organization no longer holds is refused, and every token
 * issued against that connection goes with it.
 */
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";

import type { ScimConnectionsService } from "./scim-connections.service.ts";

/**
 * The states a connection is gone in, and so takes its tokens with it. A
 * suspended connection is paused, not gone: the directory it provisions
 * through is the same directory when it resumes.
 */
const RETIRED_STATES: ReadonlySet<string> = new Set(["DISCARDED", "TORN_DOWN"]);

/** Going, not gone: its grace can still be served, so its tokens stay. */
const RETIRING_STATES: ReadonlySet<string> = new Set(["TEARDOWN_PENDING"]);

/** A replacement at these phases has retired its predecessor's directory writes, as on main. */
const RETIRING_REPLACEMENT_PHASES: ReadonlySet<string> = new Set(["FINALIZING", "FINALIZED"]);

/** The one thing retirement does to this module's rows. */
export interface ScimTokenRetirement {
  revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }>;
}

function replacedByRetiringConnection(
  connections: readonly OrganizationSsoConnection[],
  connectionId: string,
): boolean {
  return connections.some(
    (connection) =>
      connection.replacesConnectionId === connectionId &&
      connection.migrationPhase !== null &&
      RETIRING_REPLACEMENT_PHASES.has(connection.migrationPhase),
  );
}

export class ScimConnectionRetirementService {
  static create(deps: {
    connections: Pick<ScimConnectionsService, "findHeldConnections">;
    tokens: ScimTokenRetirement;
  }): ScimConnectionRetirementService {
    return new ScimConnectionRetirementService(deps);
  }

  private constructor(
    private readonly deps: {
      connections: Pick<ScimConnectionsService, "findHeldConnections">;
      tokens: ScimTokenRetirement;
    },
  ) {}

  /**
   * Whether a credential naming this connection may still write, as main's
   * `connectionAcceptsDirectoryWrites` answered by state. Refusing a gone
   * connection retires its tokens too, so the sync history says it ended.
   * A replacement that has begun finalizing refuses its predecessor too.
   */
  async admits({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<boolean> {
    const connections = await this.deps.connections.findHeldConnections({ organizationId });
    const held = connections.find((connection) => connection.connectionId === connectionId);

    if (held && RETIRING_STATES.has(held.state)) return false;
    if (held && !RETIRED_STATES.has(held.state)) {
      return !replacedByRetiringConnection(connections, connectionId);
    }
    // Finished into a replacement: its tokens move there, so refusing keeps them.
    if (replacedByRetiringConnection(connections, connectionId)) return false;

    await this.deps.tokens.revokeTokensForConnection({ organizationId, connectionId });

    return false;
  }
}
