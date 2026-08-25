import { ScimTokenService } from "@ee/scim/scim-token.service";
import { newSsoConnectionCommandId } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { prisma } from "~/server/db";
import type { ConnectionTeardownPort } from "~/server/event-sourcing/pipelines/sso-connections/process-manager/connectionTeardown.process";
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
 */
export class SsoConnectionTeardownDispatcher implements ConnectionTeardownPort {
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
      const { revoked } = await ScimTokenService.create(
        prisma,
      ).revokeForConnection({ organizationId, connectionId });
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
