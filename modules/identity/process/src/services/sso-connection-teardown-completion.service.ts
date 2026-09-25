import { createLogger } from "@langwatch/observability";

import type { ConnectionTeardown } from "../eventing/connection-teardown.process.ts";
import { newSsoConnectionCommandId } from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";

const logger = createLogger("langwatch:identity:sso-connection-teardown");

/**
 * A torn-down connection's directory tokens stop verifying with it (D08). A
 * port, not the SCIM service — that service is the whole directory
 * capability and this wake reaches ONE method of it.
 */
export abstract class SsoConnectionDirectoryRevocation {
  abstract revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }>;
}

/**
 * Dispatches the guarded `completeTeardown` command (ADR-117 §5): a command rather than a
 * projection write, so the process manager decides WHEN and the guard still decides WHETHER,
 * re-reading the folded deadline so an early wake completes nothing.
 */

/**
 * The service arrives as a PROVIDER rather than a value: the service behind it is built from a
 * ledger that isn't ready until registration returns, so deferring the read to the wake is what
 * makes the graph composable in one pass.
 */

/**
 * The command id is minted fresh per wake: a failed wake retries as itself, and the guard's
 * state check is what makes a duplicate harmless.
 */
export class SsoConnectionTeardownCompletionService implements ConnectionTeardown {
  static create(options: {
    connections: () => Pick<SsoConnectionService, "completeTeardown">;
    directory: SsoConnectionDirectoryRevocation;
  }): SsoConnectionTeardownCompletionService {
    return new SsoConnectionTeardownCompletionService(options.connections, options.directory);
  }

  private constructor(
    private readonly connections: () => Pick<SsoConnectionService, "completeTeardown">,
    private readonly directory: SsoConnectionDirectoryRevocation,
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
   * AFTER the teardown command, never instead of it. Logged, not thrown, on
   * failure: the teardown already landed, and retrying it would retry work
   * that's done — the tokens are dead either way once TORN_DOWN.
   */
  private async endDirectorySync({
    connectionId,
    organizationId,
  }: {
    connectionId: string;
    organizationId: string;
  }): Promise<void> {
    try {
      const { revoked } = await this.directory.revokeTokensForConnection({
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

/**
 * No directory capability, so no revocation — logged, not thrown, since the teardown fact
 * already landed and the tokens are unusable regardless: every SCIM request now verifies
 * against a connection this fold already moved to TORN_DOWN.
 */
export class UnrevokedSsoConnectionDirectory extends SsoConnectionDirectoryRevocation {
  static create(): UnrevokedSsoConnectionDirectory {
    return new UnrevokedSsoConnectionDirectory();
  }

  private constructor() {
    super();
  }

  async revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }> {
    logger.warn(
      { ...input, reason: "no-directory-capability" },
      "tore down a connection without deleting its directory tokens: this process composes no SCIM capability, and every token issued for the connection now fails verification against its torn-down state",
    );
    return { revoked: 0 };
  }
}
