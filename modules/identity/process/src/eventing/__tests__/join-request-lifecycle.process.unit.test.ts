import type { IntentFactories, ProcessHandlerContext } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import {
  JOIN_REQUEST_EXPIRY_MS,
  JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
  JOIN_REQUEST_REMINDER_MS,
  type JoinRequestLifecycleIntents,
  type JoinRequestLifecycleState,
  joinRequestLifecycleWake,
  onJoinApproved,
  onJoinExpired,
  onJoinRejected,
  onJoinRequested,
  onJoinResolved,
} from "../join-request-lifecycle.process.ts";

/**
 * The two timers on one wake column, and the notices every ending derives:
 * a process instance has exactly ONE `nextWakeAt`, so the day-7 reminder
 * re-arms itself to the day-14 deadline rather than a second timer existing.
 * @see specs/identity/join-requests.feature
 */

const REQUESTED_AT = 1_700_000_000_000;
const REMIND_AT = REQUESTED_AT + JOIN_REQUEST_REMINDER_MS;
const EXPIRES_AT = REQUESTED_AT + JOIN_REQUEST_EXPIRY_MS;

const requestData = (expiresAtMs: number, notifyAdmins = true) => ({
  joinRequestId: "jreq_1",
  organizationId: "org_acme",
  userId: "user_sam",
  domain: "acme.com",
  expiresAtMs,
  notifyAdmins,
});

type Intent = ReturnType<IntentFactories<JoinRequestLifecycleIntents>["remindAdmins"]>;

const intentFactory = (intentType: string) =>
  vi.fn((messageKey: string, payload: Intent["payload"]): Intent => ({
    messageKey,
    intentType,
    payload,
  }));

const ctx = (at: number): ProcessHandlerContext<JoinRequestLifecycleIntents> => ({
  at,
  now: at,
  key: "jreq_1",
  projectId: "org_acme",
  intents: {
    remindAdmins: intentFactory("remindAdmins"),
    expireRequest: intentFactory("expireRequest"),
    prepareNotification: intentFactory("prepareNotification"),
  },
});

const armed = (): JoinRequestLifecycleState =>
  onJoinRequested(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE, requestData(EXPIRES_AT), ctx(REQUESTED_AT))
    .state;

describe("given a request has just been made", () => {
  describe("when the process arms its deadlines", () => {
    it("wakes first at the halfway mark and tells the admins it arrived", () => {
      const context = ctx(REQUESTED_AT);
      const evolution = onJoinRequested(
        JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
        requestData(EXPIRES_AT),
        context,
      );

      expect(evolution.nextWakeAt).toBe(REMIND_AT);
      expect(evolution.state).toEqual({
        remindAtMs: REMIND_AT,
        expiresAtMs: EXPIRES_AT,
        remindedAt: null,
        joinRequestId: "jreq_1",
        organizationId: "org_acme",
        requesterUserId: "user_sam",
        domain: "acme.com",
      });
      expect(context.intents.prepareNotification).toHaveBeenCalledWith(
        "join-notification:jreq_1:requestArrived",
        expect.objectContaining({ kind: "requestArrived", requesterUserId: "user_sam" }),
      );
    });

    it("tells nobody when the policy is about to approve it on the spot", () => {
      const context = ctx(REQUESTED_AT);
      onJoinRequested(
        JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
        requestData(EXPIRES_AT, false),
        context,
      );

      expect(context.intents.prepareNotification).not.toHaveBeenCalled();
    });

    it("skips straight to the expiry when the window is shorter than the gap", () => {
      const soon = REQUESTED_AT + 60_000;
      const evolution = onJoinRequested(
        JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
        requestData(soon),
        ctx(REQUESTED_AT),
      );

      // A reminder sent after the thing had lapsed would be worse than none.
      expect(evolution.nextWakeAt).toBe(soon);
    });
  });
});

describe("given a request that nobody has answered", () => {
  describe("when the seventh day arrives", () => {
    /** @scenario The seventh day reminds the admins once */
    it("reminds the admins and re-arms to the expiry", () => {
      const context = ctx(REMIND_AT);
      const evolution = joinRequestLifecycleWake(armed(), context);

      expect(evolution.intents).toHaveLength(1);
      expect(context.intents.remindAdmins).toHaveBeenCalledWith(
        `join-remind:${REMIND_AT}`,
        expect.objectContaining({ requesterUserId: "user_sam", domain: "acme.com" }),
      );
      expect(evolution.nextWakeAt).toBe(EXPIRES_AT);
      expect(evolution.state.remindedAt).toBe(REMIND_AT);
    });

    it("does not remind twice when the wake is redelivered", () => {
      const reminded = joinRequestLifecycleWake(armed(), ctx(REMIND_AT)).state;

      const context = ctx(REMIND_AT + 1000);
      const evolution = joinRequestLifecycleWake(reminded, context);

      // `remindedAt` is what makes the one nudge exactly-once: a redelivered
      // day-7 wake finds it set and goes straight to re-arming.
      expect(context.intents.remindAdmins).not.toHaveBeenCalled();
      expect(evolution.intents ?? []).toHaveLength(0);
      expect(evolution.nextWakeAt).toBe(EXPIRES_AT);
    });
  });

  describe("when the fourteenth day arrives", () => {
    /** @scenario Fourteen days of silence expires the request */
    it("dispatches the expiry for the deadline it promised, keeping the facts", () => {
      const context = ctx(EXPIRES_AT);
      const evolution = joinRequestLifecycleWake(armed(), context);

      expect(context.intents.expireRequest).toHaveBeenCalledWith(`join-expire:${EXPIRES_AT}`, {
        joinRequestId: "jreq_1",
        organizationId: "org_acme",
        // Business time is the SLOT, not when the worker got round to it.
        scheduledFor: EXPIRES_AT,
      });
      expect(evolution.nextWakeAt).toBeNull();
      expect(evolution.state).toEqual(armed());
    });

    it("expires at the promised deadline even when the wake runs late", () => {
      const context = ctx(EXPIRES_AT + 3 * 60 * 60 * 1000);
      joinRequestLifecycleWake(armed(), context);

      expect(context.intents.expireRequest).toHaveBeenCalledWith(
        `join-expire:${EXPIRES_AT}`,
        expect.objectContaining({ scheduledFor: EXPIRES_AT }),
      );
    });
  });
});

describe("given a request that reached an ending", () => {
  it("tells the requester an admin approved it", () => {
    const context = ctx(REQUESTED_AT);
    onJoinApproved(armed(), { resolvedBy: { type: "user", id: "ana" } }, context);

    expect(context.intents.prepareNotification).toHaveBeenCalledWith(
      "join-notification:jreq_1:requestApproved",
      expect.objectContaining({ kind: "requestApproved", requesterUserId: "user_sam" }),
    );
  });

  it("uses the automatic notification for a policy approval", () => {
    const context = ctx(REQUESTED_AT);
    const evolution = onJoinApproved(
      armed(),
      { resolvedBy: { type: "policy", id: "domain-auto" } },
      context,
    );

    expect(context.intents.prepareNotification).toHaveBeenCalledWith(
      "join-notification:jreq_1:joinedAutomatically",
      expect.objectContaining({ kind: "joinedAutomatically" }),
    );
    expect(evolution.state).toEqual(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE);
  });

  it("closes an invitation answer without sending an approval notice", () => {
    const context = ctx(REQUESTED_AT);
    const evolution = onJoinApproved(
      armed(),
      { resolvedBy: { type: "invite", id: "invite_1" } },
      context,
    );

    expect(evolution.state).toEqual(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE);
    expect(context.intents.prepareNotification).not.toHaveBeenCalled();
  });

  it("tells the requester it was not approved", () => {
    const context = ctx(REQUESTED_AT);
    onJoinRejected(armed(), {}, context);

    expect(context.intents.prepareNotification).toHaveBeenCalledWith(
      "join-notification:jreq_1:requestRejected",
      expect.objectContaining({ kind: "requestRejected" }),
    );
  });

  describe("when the process sees the ending", () => {
    it("still names the request for a lifecycle state from the old shape", () => {
      const context = ctx(REQUESTED_AT);
      const oldState: JoinRequestLifecycleState = {
        ...JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
        remindAtMs: REMIND_AT,
        expiresAtMs: EXPIRES_AT,
      };

      onJoinExpired(oldState, {}, context);

      expect(context.intents.prepareNotification).toHaveBeenCalledWith(
        "join-notification:jreq_1:requestExpired",
        {
          kind: "requestExpired",
          notificationId: "join:jreq_1:requestExpired",
          joinRequestId: "jreq_1",
          organizationId: "org_acme",
        },
      );
    });

    /** @scenario "An expired join request tells its requester" */
    it("queues the requester's notice from the recorded expiry", () => {
      const wake = joinRequestLifecycleWake(armed(), ctx(EXPIRES_AT));
      const terminal = ctx(EXPIRES_AT);
      const expired = onJoinExpired(wake.state, {}, terminal);

      expect(expired.state).toEqual(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE);
      expect(terminal.intents.prepareNotification).toHaveBeenCalledWith(
        "join-notification:jreq_1:requestExpired",
        expect.objectContaining({ kind: "requestExpired", requesterUserId: "user_sam" }),
      );
    });

    /** @scenario The requester can withdraw and stop bothering anybody */
    it("disarms, so no reminder and no expiry wake follows", () => {
      const evolution = onJoinResolved(armed(), {}, ctx(REQUESTED_AT));

      expect(evolution.nextWakeAt).toBeNull();
      expect(evolution.state).toEqual(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE);

      // And a wake that somehow still fired does nothing at all.
      const context = ctx(EXPIRES_AT);
      const afterwards = joinRequestLifecycleWake(evolution.state, context);
      expect(context.intents.expireRequest).not.toHaveBeenCalled();
      expect(context.intents.remindAdmins).not.toHaveBeenCalled();
      expect(afterwards.nextWakeAt).toBeNull();
    });
  });
});
