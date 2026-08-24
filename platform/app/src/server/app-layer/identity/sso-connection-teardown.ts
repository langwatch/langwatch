import { newSsoConnectionCommandId } from "@langwatch/identity-server";
import type { ConnectionTeardownPort } from "~/server/event-sourcing/pipelines/sso-connections/process-manager/connectionTeardown.process";
import { ssoConnections } from "./runtime";

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
  }
}
