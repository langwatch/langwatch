import { SYSTEM_ACTORS } from "@langwatch/actor";
import { createLogger } from "@langwatch/observability";
import { newJoinRequestCommandId } from "../rules/join-request-id.rules.ts";
import type { PrismaJoinRequestReadRepository } from "../repositories/prisma/prisma.join-request.repository.ts";
import type { JoinRequestLifecycle } from "../eventing/join-request-lifecycle.process.ts";
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
    // decided (ADR-135).
    //
    // `expireJoin` used to be read for its return value, which is the facts
    // the guard produced ON THIS THREAD. The same guard runs again on the
    // queue, against state that may have moved in between, and the queue's run
    // is the one whose events are stored. An administrator approving inside
    // the expiry window is exactly that divergence: the calling path reads
    // PENDING and states an expiry, the approval folds first, the queue's
    // re-run reads APPROVED and states nothing. Gating the email on the
    // returned facts sent that person a notice that their request had lapsed,
    // moments after it was in fact granted — which this function's own comment
    // already called worse than telling them nothing.
    //
    // So the projection is what is read, and only the PENDING -> EXPIRED
    // transition is announced. Requiring the transition rather than merely the
    // end state is what keeps a replayed wake silent about a request that
    // expired an hour ago and was already announced then.
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

    // Still PENDING here means the fold has not landed — the ledger's
    // read-your-writes window was already spent inside `expireJoin`, so this
    // is the projection genuinely lagging rather than a wake that fired early.
    // Nothing is sent, because a notice we cannot substantiate is the failure
    // this whole change exists to remove; but an expiry nobody is ever told
    // about is its own quiet defect, so it is said out loud here rather than
    // returning in silence. Any other state is the ordinary case of somebody
    // having answered the request first, and is not worth a line.
    if (recorded?.state === "PENDING") {
      logger.warn(
        { joinRequestId, organizationId },
        "expiry wake could not confirm the request expired before telling the requester; the command is queued and the fold will converge, but this notice will not be sent",
      );
    }
  }
}
