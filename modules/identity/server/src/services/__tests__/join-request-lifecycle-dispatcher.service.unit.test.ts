/**
 * The expiry wake's one decision: whether to tell the requester their request
 * lapsed. ADR-135 — what gets announced is what was RECORDED, never what this
 * thread decided, since the guard runs twice (once on the calling path, once on
 * the queue) and only the queue's run is stored; gating on this thread's own
 * facts could tell someone "lapsed" moments after an admin actually approved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JoinRequestLifecycleDispatcherAdapter } from "../join-request-lifecycle-dispatcher.service.ts";
import type { PrismaJoinRequestReadRepository } from "../../repositories/prisma/prisma.join-request.repository.ts";
import type { JoinRequestNotifier } from "../../rules/join-requests-contract.rules.ts";
import type { JoinRequestService } from "../join-request.service.ts";

const ORGANIZATION_ID = "org_1";
const JOIN_REQUEST_ID = "jr_1";
const REQUESTER_ID = "usr_1";

/** The two reads the dispatcher makes, answered in order. */
function readsAnswering(
  states: readonly (string | null)[],
): Pick<PrismaJoinRequestReadRepository, "tryFindRequest"> {
  const tryFindRequest = vi.fn(async () => {
    const state = states[tryFindRequest.mock.calls.length - 1] ?? null;
    return state === null ? null : ({ userId: REQUESTER_ID, state } as never);
  });
  return { tryFindRequest };
}

let notifier: JoinRequestNotifier;
let requestExpired: ReturnType<typeof vi.fn>;
let expireJoin: ReturnType<typeof vi.fn>;

beforeEach(() => {
  requestExpired = vi.fn(async () => {});
  notifier = { requestExpired } as unknown as JoinRequestNotifier;
  // The facts this thread's guard produced. Deliberately non-empty everywhere
  // below: the whole point is that they no longer decide anything.
  expireJoin = vi.fn(async () => [{ type: "join.expired" }]);
});

function dispatcherOver(states: readonly (string | null)[]) {
  return JoinRequestLifecycleDispatcherAdapter.create(
    readsAnswering(states),
    notifier,
    () => ({ expireJoin }) as unknown as JoinRequestService,
  );
}

describe("the join-request expiry wake", () => {
  describe("when the request was pending and the projection recorded the expiry", () => {
    /** @scenario "An expired join request tells its requester" */
    it("tells the requester their request lapsed", async () => {
      await dispatcherOver(["PENDING", "EXPIRED"]).expireRequest({
        joinRequestId: JOIN_REQUEST_ID,
        organizationId: ORGANIZATION_ID,
        occurredAtMs: 1,
      });

      expect(requestExpired).toHaveBeenCalledWith({
        joinRequestId: JOIN_REQUEST_ID,
        organizationId: ORGANIZATION_ID,
        requesterUserId: REQUESTER_ID,
      });
    });
  });

  describe("when an administrator approved inside the expiry window", () => {
    /** @scenario "An expired join request tells its requester" */
    it("says nothing, even though this thread's guard produced expiry facts", async () => {
      await dispatcherOver(["PENDING", "APPROVED"]).expireRequest({
        joinRequestId: JOIN_REQUEST_ID,
        organizationId: ORGANIZATION_ID,
        occurredAtMs: 1,
      });

      expect(expireJoin).toHaveBeenCalledTimes(1);
      expect(requestExpired).not.toHaveBeenCalled();
    });
  });

  describe("when the request had already been answered before the wake fired", () => {
    it("says nothing and does not read the projection a second time", async () => {
      const dispatcher = dispatcherOver(["APPROVED"]);

      await dispatcher.expireRequest({
        joinRequestId: JOIN_REQUEST_ID,
        organizationId: ORGANIZATION_ID,
        occurredAtMs: 1,
      });

      expect(requestExpired).not.toHaveBeenCalled();
    });
  });

  describe("when the fold has not landed yet", () => {
    // A notice we cannot substantiate is the failure this change removes, so
    // nothing is sent — but the command is queued and will converge.
    it("sends nothing while the projection still reads pending", async () => {
      await dispatcherOver(["PENDING", "PENDING"]).expireRequest({
        joinRequestId: JOIN_REQUEST_ID,
        organizationId: ORGANIZATION_ID,
        occurredAtMs: 1,
      });

      expect(requestExpired).not.toHaveBeenCalled();
    });
  });
});
