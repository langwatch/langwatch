/**
 * The expiry wake's one decision: whether to tell the requester their request
 * lapsed.
 *
 * ADR-135 — what gets announced is what was RECORDED, never what this thread
 * decided. The guard runs twice (once on the calling path, once on the queue)
 * and only the queue's run is stored, so the facts this thread got back are a
 * prediction. The divergence that matters is an administrator approving inside
 * the expiry window: gating the email on the returned facts told that person
 * their request had lapsed moments after it was in fact granted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JoinRequestLifecycleDispatcherAdapter } from "../join-request-lifecycle-dispatcher.service.ts";
import type { JoinRequestNotifier } from "../../rules/join-requests-contract.rules.ts";
import type { JoinRequestService } from "../join-request.service.ts";

const ORGANIZATION_ID = "org_1";
const JOIN_REQUEST_ID = "jr_1";
const REQUESTER_ID = "usr_1";

/** The two reads the dispatcher makes, answered in order. */
function prismaAnswering(states: readonly (string | null)[]) {
  const findUnique = vi.fn(async () => {
    const state = states[findUnique.mock.calls.length - 1] ?? null;
    return state === null ? null : { userId: REQUESTER_ID, state };
  });
  return { joinRequest: { findUnique } } as never;
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
    prismaAnswering(states),
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
