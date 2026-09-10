import { SYSTEM_ACTORS } from "@langwatch/actor";
import { newJoinRequestCommandId } from "../rules/join-request-id.rules.ts";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { JoinRequestLifecycle } from "../processes/join-request-lifecycle.process.ts";
import type { JoinRequestNotifier } from "../rules/join-requests-contract.rules.ts";
import type { JoinRequestService } from "./join-request.service.ts";

/**
 * What the two wakes actually do (D12): send the one reminder, and dispatch the guarded
 * `expireJoin` command. A command rather than a projection write, and that is the point — the
 * process manager decides WHEN, the guard still decides WHETHER.
 */
export class JoinRequestLifecycleDispatcherAdapter implements JoinRequestLifecycle {
  static create(
    prisma: PrismaClient,
    notifier: JoinRequestNotifier,
    joinRequests: () => JoinRequestService,
  ): JoinRequestLifecycleDispatcherAdapter {
    return new JoinRequestLifecycleDispatcherAdapter(prisma, notifier, joinRequests);
  }

  private constructor(
    private readonly prisma: PrismaClient,
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
    // tell" question independent of when the projection catches up.
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
      select: { userId: true, state: true },
    });

    const facts = await this.joinRequests().expireJoin({
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
    await this.notifier.requestExpired({
      joinRequestId,
      organizationId,
      requesterUserId: request.userId,
    });
  }
}
