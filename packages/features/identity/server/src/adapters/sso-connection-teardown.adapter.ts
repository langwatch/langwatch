/**
 * The directory side of a teardown, narrowed to the one call this makes. The SCIM service that
 * satisfies it is ENTERPRISE; identity is core and may not depend on it, so what the wake needs is
 * stated here and the composition binds the enterprise service to it.
 */
export interface ConnectionDirectoryRevocation {
  revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }>;
}
import type { ConnectionTeardownPort } from "../processes/connection-teardown.process";
import { newSsoConnectionCommandId } from "../sso-connection-id";
import type { SsoConnectionService } from "../sso-connection.service";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:identity:sso-connection-teardown");

/**
 * What the teardown grace wake actually does: dispatch the guarded A command rather than a
 * projection write, and that is the point — the process manager decides WHEN,
 * `completeTeardown` command (ADR-117 §5).
 */
export class SsoConnectionTeardownDispatcherAdapter implements ConnectionTeardownPort {
  static create({
    connections,
    scim,
  }: {
    connections: () => SsoConnectionService;
    scim: () => ConnectionDirectoryRevocation;
  }): SsoConnectionTeardownDispatcherAdapter {
    return new SsoConnectionTeardownDispatcherAdapter(connections, scim);
  }

  constructor(
    private readonly connections: () => SsoConnectionService,
    private readonly scim: () => ConnectionDirectoryRevocation,
  ) {}

  async completeTeardown({
    connectionId,
    organizationId,
    occurredAtMs,
  }: {
    connectionId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void> {
    await this.connections().completeTeardown({
      tenantId: organizationId,
      organizationId,
      connectionId,
      commandId: newSsoConnectionCommandId(),
      occurredAtMs,
      actor: { type: "system", id: null },
      source: "self-serve",
    });
    await this.endDirectorySync({ connectionId, organizationId });
  }

  /**
   * A torn-down connection's directory tokens stop verifying with it (D08). The connection was the
   * whole of what those tokens could reach, so a token that outlived it would be a directory
   * writing into an organization that no longer trusts it.
   */
  private async endDirectorySync({
    connectionId,
    organizationId,
  }: {
    connectionId: string;
    organizationId: string;
  }): Promise<void> {
    try {
      const { revoked } = await this.scim().revokeTokensForConnection({
        organizationId,
        connectionId,
      });
      if (revoked > 0) {
        logger.info(
          { connectionId, organizationId, revoked },
          "tore down a connection and revoked the directory tokens issued for it",
        );
      }
    } catch (error) {
      logger.error(
        { connectionId, organizationId, error },
        "could not revoke a torn-down connection's directory tokens; the teardown itself stands",
      );
    }
  }
}
