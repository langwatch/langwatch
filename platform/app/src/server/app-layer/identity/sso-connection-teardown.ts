import type { ScimService } from "@langwatch/enterprise-scim-contract";
import type { ConnectionTeardownPort } from "@langwatch/identity-eventing";
import { newSsoConnectionCommandId } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { ssoConnections } from "./runtime";

const logger = createLogger("langwatch:identity:sso-connection-teardown");

/**
 * What the teardown grace wake actually does: dispatch the guarded
 * `completeTeardown` command (ADR-117 §5).
 *
 * A command rather than a projection write, and that is the point — the
 * process manager decides WHEN, the guard still decides WHETHER. It re-reads
 * the folded deadline, so a wake that fires early (a lagged queue, a replayed
 * job, a hand-run maintenance script) completes nothing.
 *
 * The service is composed per call because the ledger inside it resolves the
 * pipeline handle lazily off the App, which is what lets this be constructed
 * during composition and still append once the App exists. The command id is
 * minted fresh per wake: a wake that ran and failed should retry as itself,
 * and the guard's state check is what makes a duplicate harmless.
 *
 * The directory service arrives as a PROVIDER for the same reason. The
 * pipeline takes this port at registration time, and the composition root
 * builds the SCIM service after that — it needs the governance runtime, which
 * needs the commands `registerAll()` returns. A provider defers the read to
 * the wake, which is the only moment the token revocation actually happens.
 */
export class SsoConnectionTeardownDispatcher implements ConnectionTeardownPort {
  constructor(private readonly scim: () => ScimService) {}

  async completeTeardown({
    connectionId,
    organizationId,
    occurredAtMs,
  }: {
    connectionId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void> {
    await ssoConnections().completeTeardown({
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
   * A torn-down connection's directory tokens stop verifying with it (D08).
   *
   * The connection was the whole of what those tokens could reach, so a
   * token that outlived it would be a directory writing into an organization
   * that no longer trusts it. Every other connection's tokens are untouched.
   *
   * AFTER the teardown command, and never instead of it: the connection
   * being torn down is the fact, and revoking its credentials is the
   * consequence. A failure here is logged rather than thrown — the teardown
   * itself has already landed, and turning a token-cleanup failure into a
   * failed wake would retry a teardown that is already complete. The tokens
   * are dead either way, because the connection they name is TORN_DOWN.
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
