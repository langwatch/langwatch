import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  type JoinRequestService,
  newJoinRequestCommandId,
  type JoinRequestNotificationService,
} from "@langwatch/identity-server";
import type { JoinRequestLifecyclePort } from "../join-requests/process-manager/joinRequestLifecycle.process";
import type { PrismaJoinRequestProjectionRepository } from "../repositories/prisma/prisma.join-request-projection.repository";

export type EventingJoinRequestLifecycleOptions = {
  /** The write surface the expiry wake dispatches its command through. */
  requests: JoinRequestService;
  /** The folded head, read to learn who asked before the state changes. */
  reads: Pick<PrismaJoinRequestProjectionRepository, "findRequest">;
  /** Who is told, and how. */
  notifications: JoinRequestNotificationService;
};

/**
 * What the two wakes actually do (D12): send the one reminder, and dispatch
 * the guarded `expireJoin` command.
 *
 * A command rather than a projection write, and that is the point — the
 * process manager decides WHEN, the guard still decides WHETHER. It re-reads
 * the folded deadline, so a wake that fires early expires nothing.
 */
export class EventingJoinRequestLifecycleAdapter implements JoinRequestLifecyclePort {
  static create(options: EventingJoinRequestLifecycleOptions): EventingJoinRequestLifecycleAdapter {
    return new EventingJoinRequestLifecycleAdapter(options);
  }

  private constructor(private readonly options: EventingJoinRequestLifecycleOptions) {}

  async remindAdmins({
    joinRequestId,
    organizationId,
  }: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<void> {
    await this.options.notifications.requestStillWaiting({ joinRequestId, organizationId });
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
    // tell" question independent of when the projection catches up.
    const request = await this.options.reads.findRequest({ joinRequestId });

    const facts = await this.options.requests.expireJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs,
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      scheduledFor: occurredAtMs,
    });

    // Only if something actually expired. A wake that fired early, or one for
    // a request an admin answered in the meantime, states nothing — and
    // telling somebody their request lapsed when it did not would be worse
    // than telling them nothing.
    if (facts.length === 0 || !request) return;
    await this.options.notifications.requestExpired({
      joinRequestId,
      organizationId,
      requesterUserId: request.userId,
    });
  }
}
