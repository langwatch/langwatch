// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A provisioning token reaches no further than the life of the connection it
 * was issued against (D08). Identity states that lifecycle and counts no
 * token of ours, so the retirement is this module's own: a credential naming
 * a connection the organization no longer holds is refused, and every token
 * issued against that connection goes with it.
 */
import type { ScimConnectionsService } from "./scim-connections.service.ts";

/**
 * The states a connection is gone in. A suspended connection is paused, not
 * gone — an operator stopped it deciding sign-ins, and the directory it
 * provisions through is the same directory when it resumes.
 */
const RETIRED_STATES: ReadonlySet<string> = new Set(["DISCARDED", "REJECTED", "TORN_DOWN"]);

/** The one thing retirement does to this module's rows. */
export interface ScimTokenRetirement {
  revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }>;
}

export class ScimConnectionRetirementService {
  static create(deps: {
    connections: Pick<ScimConnectionsService, "findConnections">;
    tokens: ScimTokenRetirement;
  }): ScimConnectionRetirementService {
    return new ScimConnectionRetirementService(deps);
  }

  private constructor(
    private readonly deps: {
      connections: Pick<ScimConnectionsService, "findConnections">;
      tokens: ScimTokenRetirement;
    },
  ) {}

  /**
   * Whether a credential naming this connection may still write. The refusal
   * retires the connection's tokens on its way out, so the directory is told
   * once rather than told every push that its credential is unknown, and the
   * sync history says the provisioning ended.
   */
  async admits({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<boolean> {
    const held = (await this.deps.connections.findConnections({ organizationId })).find(
      (connection) => connection.connectionId === connectionId,
    );

    if (held && !RETIRED_STATES.has(held.state)) return true;

    await this.deps.tokens.revokeTokensForConnection({ organizationId, connectionId });

    return false;
  }
}
