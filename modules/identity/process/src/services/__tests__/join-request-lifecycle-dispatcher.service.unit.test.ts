/**
 * What the lifecycle's intents do. Every notice comes from a recorded event
 * (ADR-135), so the expiry wake only dispatches the guarded command and the
 * requester is told when the expiry fact itself is folded.
 */
import {
  emptyJoinRequest,
  JoinRequestNotFoundError,
  type JoinRequestState,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JoinRequestNotification } from "../../eventing/join-request-lifecycle.process.ts";
import type { PrismaJoinRequestReadRepository } from "../../repositories/prisma/prisma.join-request.repository.ts";
import type { JoinRequestNotifier } from "../../rules/join-requests-contract.rules.ts";
import { JoinRequestLifecycleDispatcherAdapter } from "../join-request-lifecycle-dispatcher.service.ts";
import type { JoinRequestService } from "../join-request.service.ts";

const ORGANIZATION_ID = "org_1";
const JOIN_REQUEST_ID = "jr_1";
const REQUESTER_ID = "usr_1";

type Recorded = { method: keyof JoinRequestNotifier; args: unknown };

class RecordingNotifier implements JoinRequestNotifier {
  readonly sent: Recorded[] = [];

  private record(method: keyof JoinRequestNotifier, args: unknown): Promise<void> {
    this.sent.push({ method, args });
    return Promise.resolve();
  }

  requestArrived(args: unknown) {
    return this.record("requestArrived", args);
  }
  requestStillWaiting(args: unknown) {
    return this.record("requestStillWaiting", args);
  }
  requestApproved(args: unknown) {
    return this.record("requestApproved", args);
  }
  requestRejected(args: unknown) {
    return this.record("requestRejected", args);
  }
  requestExpired(args: unknown) {
    return this.record("requestExpired", args);
  }
  joinedAutomatically(args: unknown) {
    return this.record("joinedAutomatically", args);
  }
}

let notifier: RecordingNotifier;
let expireJoin: ReturnType<typeof vi.fn<JoinRequestService["expireJoin"]>>;

function readsAnswering(
  state: JoinRequestState | null,
): Pick<PrismaJoinRequestReadRepository, "getRequest"> {
  return {
    getRequest: vi.fn(async () => {
      if (state === null) throw new JoinRequestNotFoundError("no such request");
      return {
        ...emptyJoinRequest({ joinRequestId: JOIN_REQUEST_ID }),
        userId: REQUESTER_ID,
        domain: "acme.com",
        state,
      };
    }),
  };
}

function dispatcherOver(state: JoinRequestState | null) {
  return JoinRequestLifecycleDispatcherAdapter.create(readsAnswering(state), notifier, () => ({
    expireJoin,
  }));
}

const notice = (
  kind: JoinRequestNotification["kind"],
  extra: Partial<JoinRequestNotification> = {},
): { payload: JoinRequestNotification } => ({
  payload: {
    kind,
    notificationId: `join:${JOIN_REQUEST_ID}:${kind}`,
    joinRequestId: JOIN_REQUEST_ID,
    organizationId: ORGANIZATION_ID,
    ...extra,
  },
});

beforeEach(() => {
  notifier = new RecordingNotifier();
  expireJoin = vi.fn<JoinRequestService["expireJoin"]>(async () => []);
});

describe("the join-request expiry wake", () => {
  /** @scenario "The expiry wake dispatches a command rather than writing the row" */
  it("dispatches the guarded command and tells nobody itself", async () => {
    await dispatcherOver("PENDING").expireRequest({
      joinRequestId: JOIN_REQUEST_ID,
      organizationId: ORGANIZATION_ID,
      occurredAtMs: 1,
    });

    expect(expireJoin).toHaveBeenCalledWith(
      expect.objectContaining({ joinRequestId: JOIN_REQUEST_ID, scheduledFor: 1 }),
    );
    expect(notifier.sent).toEqual([]);
  });
});

describe("a notice derived from a recorded fact", () => {
  describe("when the expiry was recorded", () => {
    /** @scenario "An expired join request tells its requester" */
    it("tells the requester their request lapsed", async () => {
      await dispatcherOver("EXPIRED").prepareNotification(
        notice("requestExpired", { requesterUserId: REQUESTER_ID }),
      );

      expect(notifier.sent).toEqual([
        {
          method: "requestExpired",
          args: {
            joinRequestId: JOIN_REQUEST_ID,
            organizationId: ORGANIZATION_ID,
            requesterUserId: REQUESTER_ID,
          },
        },
      ]);
    });
  });

  describe("when a notice was queued before the process carried who asked", () => {
    it("reads the requester and the domain from the request", async () => {
      await dispatcherOver("PENDING").prepareNotification(notice("requestArrived"));

      expect(notifier.sent).toEqual([
        {
          method: "requestArrived",
          args: {
            joinRequestId: JOIN_REQUEST_ID,
            organizationId: ORGANIZATION_ID,
            requesterUserId: REQUESTER_ID,
            domain: "acme.com",
          },
        },
      ]);
    });
  });

  describe("when the day-7 reminder arrives for a request already answered", () => {
    it("sends nothing", async () => {
      await dispatcherOver("APPROVED").prepareNotification(notice("requestStillWaiting"));

      expect(notifier.sent).toEqual([]);
    });
  });

  describe("when the day-7 reminder arrives for a request still waiting", () => {
    it("reminds the admins", async () => {
      await dispatcherOver("PENDING").prepareNotification(notice("requestStillWaiting"));

      expect(notifier.sent.map((sent) => sent.method)).toEqual(["requestStillWaiting"]);
    });
  });

  describe("when nobody can be named as the requester", () => {
    /** @scenario "A notification with nobody to address is not sent" */
    it("sends nothing rather than a notice about nobody", async () => {
      await dispatcherOver(null).prepareNotification(notice("requestApproved"));

      expect(notifier.sent).toEqual([]);
    });
  });
});
