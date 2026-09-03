import { newSsoConnectionCommandId } from "../sso-connection-id";
import type { SsoConnectionService } from "../sso-connection.service";
import { createLogger } from "@langwatch/observability";
import type { ConnectionTeardownPort } from "../processes/connection-teardown.process";

const logger = createLogger("langwatch:identity:sso-connection-teardown");

/**
 * A torn-down connection's directory tokens stop verifying with it (D08).
 *
 * A port rather than the SCIM service, because that service is the whole
 * directory capability and this wake reaches ONE method of it. Answering
 * `revoked` lets a process that has a directory report what it retired and a
 * process that has none say so by name.
 */
export abstract class SsoConnectionDirectoryRevocationPort {
  abstract revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }>;
}

/**
 * What the teardown grace wake actually does: dispatch the guarded
 * `completeTeardown` command (ADR-117 §5).
 *
 * A command rather than a projection write, and that is the point — the
 * process manager decides WHEN, the guard still decides WHETHER. It re-reads
 * the folded deadline, so a wake that fires early (a lagged queue, a replayed
 * job, a hand-run maintenance script) completes nothing.
 *
 * The service arrives as a PROVIDER rather than a value. The pipeline takes
 * this port at registration time, and the service behind it is built from a
 * ledger whose staged sender only exists once that same registration has
 * returned. Deferring the read to the wake is what makes the graph composable
 * in one pass.
 *
 * The command id is minted fresh per wake: a wake that ran and failed should
 * retry as itself, and the guard's state check is what makes a duplicate
 * harmless.
 */
export class EventingSsoConnectionTeardownAdapter implements ConnectionTeardownPort {
  static create(options: {
    connections: () => Pick<SsoConnectionService, "completeTeardown">;
    directory: SsoConnectionDirectoryRevocationPort;
  }): EventingSsoConnectionTeardownAdapter {
    return new EventingSsoConnectionTeardownAdapter(options.connections, options.directory);
  }

  private constructor(
    private readonly connections: () => Pick<SsoConnectionService, "completeTeardown">,
    private readonly directory: SsoConnectionDirectoryRevocationPort,
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
   * AFTER the teardown command, and never instead of it: the connection being
   * torn down is the fact, and revoking its credentials is the consequence. A
   * failure here is logged rather than thrown — the teardown itself has
   * already landed, and turning a token-cleanup failure into a failed wake
   * would retry a teardown that is already complete. The tokens are dead
   * either way, because the connection they name is TORN_DOWN.
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
 * The revocation a process with no directory capability performs: none, said
 * out loud.
 *
 * It logs rather than throwing, for the reason the real adapter catches: the
 * teardown fact has already landed by the time this runs, and failing the
 * wake would retry a completed teardown forever. The tokens are unusable
 * regardless — every SCIM request verifies against a connection this fold has
 * just moved to TORN_DOWN — so what is actually lost is the row deletion, not
 * the security property.
 */
export class UnrevokedSsoConnectionDirectory extends SsoConnectionDirectoryRevocationPort {
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
