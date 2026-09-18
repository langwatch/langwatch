import { SYSTEM_ACTORS } from "@langwatch/actor";
import { createLogger } from "@langwatch/observability";

import type { JoinRequestLifecycle } from "../eventing/join-request-lifecycle.process.ts";
import type { PrismaJoinRequestReadRepository } from "../repositories/prisma/prisma.join-request.repository.ts";
import { newJoinRequestCommandId } from "../rules/join-request-id.rules.ts";
import type { JoinRequestNotifier } from "../rules/join-requests-contract.rules.ts";
import type { JoinRequestService } from "./join-request.service.ts";

/**
 * What the two wakes actually do (D12): send the one reminder, and dispatch the guarded
 * `expireJoin` command. A command rather than a projection write, and that is the point — the
 * process manager decides WHEN, the guard still decides WHETHER.
 */
const logger = createLogger("langwatch:identity:join-request-lifecycle");

export class JoinRequestLifecycleDispatcherAdapter implements JoinRequestLifecycle {
  static create(
    reads: Pick<PrismaJoinRequestReadRepository, "tryFindRequest">,
    notifier: JoinRequestNotifier,
    joinRequests: () => JoinRequestService,
  ): JoinRequestLifecycleDispatcherAdapter {
    return new JoinRequestLifecycleDispatcherAdapter(reads, notifier, joinRequests);
  }

  private constructor(
    private readonly reads: Pick<PrismaJoinRequestReadRepository, "tryFindRequest">,
    private readonly notifier: JoinRequestNotifier,
    private readonly joinRequests: () => JoinRequestService,
  ) {}

  async remindAdmins({
    joinRequestId,
    organizationId,
  }: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<void> {
    await this.notifier.requestStillWaiting({ joinRequestId, organizationId });
  }

  async expireRequest({
    joinRequestId,
    organizationId,
    occurredAtMs,
  }: {
    joinRequestId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void> {
    // Read the requester BEFORE the command: the fold that follows it is the
    // only thing that changes here, and reading first keeps the "who do we
    // tell" question independent of when the projection catches up. The state
    // read alongside it is the BEFORE half of the one transition this wake is
    // allowed to announce.
    const before = await this.reads.tryFindRequest({ joinRequestId });

    await this.joinRequests().expireJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs,
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      scheduledFor: occurredAtMs,
    });

    // What gets announced is what was RECORDED, never what this thread
    // decided (ADR-135): reading the guard's own return value could send an
    // expiry notice for a request the queue's re-run actually approved.
    // Requiring the PENDING -> EXPIRED transition, not just the end state,
    // keeps a replayed wake silent about an expiry already announced.
    if (before?.state !== "PENDING") return;

    const recorded = await this.reads.tryFindRequest({ joinRequestId });
    if (recorded?.state === "EXPIRED") {
      await this.notifier.requestExpired({
        joinRequestId,
        organizationId,
        requesterUserId: before.userId,
      });
      return;
    }

    // Still PENDING means the fold hasn't landed (read-your-writes was
    // already spent inside `expireJoin`) — genuine lag, not an early wake.
    // Nothing is sent, since an unsubstantiated notice is the failure this
    // exists to remove; logged so a silent expiry isn't a quiet defect too.
    if (recorded?.state === "PENDING") {
      logger.warn(
        { joinRequestId, organizationId },
        "expiry wake could not confirm the request expired before telling the requester; the command is queued and the fold will converge, but this notice will not be sent",
      );
    }
  }
}
