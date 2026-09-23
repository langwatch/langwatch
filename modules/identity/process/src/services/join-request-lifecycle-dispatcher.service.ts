import { SYSTEM_ACTORS } from "@langwatch/actor";
import { createLogger } from "@langwatch/observability";

import type {
  JoinRequestLifecycle,
  JoinRequestNotification,
} from "../eventing/join-request-lifecycle.process.ts";
import type { PrismaJoinRequestReadRepository } from "../repositories/prisma/prisma.join-request.repository.ts";
import { newJoinRequestCommandId } from "../rules/join-request-id.rules.ts";
import type { JoinRequestNotifier } from "../rules/join-requests-contract.rules.ts";
import type { JoinRequestService } from "./join-request.service.ts";

const logger = createLogger("langwatch:identity:join-request-lifecycle");

/**
 * What the lifecycle's intents actually do (D12): dispatch the guarded `expireJoin` command, and
 * tell people about a fact the pipeline recorded. The process manager decides WHEN, the guard
 * still decides WHETHER, and every notice comes from a recorded event (ADR-135).
 */
export class JoinRequestLifecycleDispatcherAdapter implements JoinRequestLifecycle {
  static create(
    reads: Pick<PrismaJoinRequestReadRepository, "tryFindRequest">,
    notifier: JoinRequestNotifier,
    joinRequests: () => Pick<JoinRequestService, "expireJoin">,
  ): JoinRequestLifecycleDispatcherAdapter {
    return new JoinRequestLifecycleDispatcherAdapter(reads, notifier, joinRequests);
  }

  private constructor(
    private readonly reads: Pick<PrismaJoinRequestReadRepository, "tryFindRequest">,
    private readonly notifier: JoinRequestNotifier,
    private readonly joinRequests: () => Pick<JoinRequestService, "expireJoin">,
  ) {}

  async expireRequest({
    joinRequestId,
    organizationId,
    occurredAtMs,
  }: {
    joinRequestId: string;
    organizationId: string;
    occurredAtMs: number;
  }): Promise<void> {
    await this.joinRequests().expireJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs,
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      scheduledFor: occurredAtMs,
    });
  }

  /**
   * One notice, re-reading the request first: a reminder for a request that has since been
   * answered is dropped, and a notice queued before the process carried who asked reads it here.
   */
  async prepareNotification({ payload }: { payload: JoinRequestNotification }): Promise<void> {
    const { joinRequestId, organizationId } = payload;
    const request = await this.reads.tryFindRequest({ joinRequestId });

    if (payload.kind === "requestStillWaiting") {
      if (request?.state !== "PENDING") return;
      await this.notifier.requestStillWaiting({ joinRequestId, organizationId });
      return;
    }

    const requesterUserId = payload.requesterUserId ?? request?.userId;
    const domain = payload.domain ?? request?.domain;
    if (!requesterUserId) {
      logger.warn(
        { joinRequestId, organizationId, kind: payload.kind },
        "join request notice has no requester to name; nothing was sent",
      );
      return;
    }

    switch (payload.kind) {
      case "requestApproved":
        return this.notifier.requestApproved({ joinRequestId, organizationId, requesterUserId });
      case "requestRejected":
        return this.notifier.requestRejected({ joinRequestId, organizationId, requesterUserId });
      case "requestExpired":
        return this.notifier.requestExpired({ joinRequestId, organizationId, requesterUserId });
      case "requestArrived":
      case "joinedAutomatically":
        if (!domain) {
          logger.warn(
            { joinRequestId, organizationId, kind: payload.kind },
            "join request notice has no domain to name; nothing was sent",
          );
          return;
        }
        return payload.kind === "requestArrived"
          ? this.notifier.requestArrived({ joinRequestId, organizationId, requesterUserId, domain })
          : this.notifier.joinedAutomatically({
              joinRequestId,
              organizationId,
              requesterUserId,
              domain,
            });
    }
  }
}
