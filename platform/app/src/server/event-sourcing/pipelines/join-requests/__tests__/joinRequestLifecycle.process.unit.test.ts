import { describe, expect, it, vi } from "vitest";
import type { ProcessHandlerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import type { ProcessIntent } from "~/server/event-sourcing/process-manager/processManager.types";
import {
  JOIN_REQUEST_EXPIRY_MS,
  JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
  JOIN_REQUEST_REMINDER_MS,
  type JoinRequestLifecycleIntents,
  type JoinRequestLifecycleState,
  joinRequestLifecycleWake,
  onJoinApproved,
  onJoinExpired,
  onJoinRequested,
  onJoinResolved,
} from "../process-manager/joinRequestLifecycle.process";

/**
 * The two timers on one wake column.
 *
 * A process instance has exactly ONE `nextWakeAt`, so the day-7 reminder
 * re-arms itself to the day-14 deadline rather than a second timer existing.
 * These tests are the readable statement of that: what each wake does, and
 * what disarms it.
 *
 * Spec: specs/identity/join-requests.feature
 */

const REQUESTED_AT = 1_700_000_000_000;
const REMIND_AT = REQUESTED_AT + JOIN_REQUEST_REMINDER_MS;
const EXPIRES_AT = REQUESTED_AT + JOIN_REQUEST_EXPIRY_MS;
const requestData = (expiresAtMs: number) => ({
  joinRequestId: "jreq_1",
  organizationId: "org_acme",
  userId: "user_sam",
  domain: "acme.com",
  expiresAtMs,
  notifyAdmins: true,
});

const intentFactory = (intentType: string) =>
  vi.fn(
    (messageKey: string, payload: JsonValue): ProcessIntent => ({
      messageKey,
      intentType,
      payload,
    }),
  );

const ctx = (
  at: number,
): ProcessHandlerContext<JoinRequestLifecycleIntents> => ({
  at,
  now: at,
  key: "jreq_1",
  projectId: "org_acme",
  intents: {
    remindAdmins: intentFactory("remindAdmins"),
    expireRequest: intentFactory("expireRequest"),
    attachMembershipGrant: intentFactory("attachMembershipGrant"),
    prepareNotification: intentFactory("prepareNotification"),
    fanoutNotification: intentFactory("fanoutNotification"),
    sendNotification: intentFactory("sendNotification"),
  },
});

const armed = (): JoinRequestLifecycleState =>
  onJoinRequested(
    JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
    requestData(EXPIRES_AT),
    ctx(REQUESTED_AT),
  ).state;

describe("given a request has just been made", () => {
  describe("when the process arms its deadlines", () => {
    it("wakes first at the halfway mark, not at the expiry", () => {
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
        expect.objectContaining({ kind: "requestArrived" }),
      );
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
      expect(context.intents.remindAdmins).toHaveBeenCalledOnce();
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
    it("dispatches the expiry for the deadline it promised", () => {
      const context = ctx(EXPIRES_AT);
      const evolution = joinRequestLifecycleWake(armed(), context);

      expect(context.intents.expireRequest).toHaveBeenCalledWith(
        `join-expire:${EXPIRES_AT}`,
        {
          joinRequestId: "jreq_1",
          organizationId: "org_acme",
          // Business time is the SLOT, not when the worker got round to it.
          scheduledFor: EXPIRES_AT,
        },
      );
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

  describe("when the process sees the ending", () => {
    it("retains notification identity for a lifecycle state from the old shape", () => {
      const context = ctx(REQUESTED_AT);
      const oldState: JoinRequestLifecycleState = {
        remindAtMs: REMIND_AT,
        expiresAtMs: EXPIRES_AT,
        remindedAt: null,
        joinRequestId: null,
        organizationId: null,
        requesterUserId: null,
        domain: null,
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

    it("keeps expiry facts until the terminal event queues the requester notice", () => {
      const context = ctx(EXPIRES_AT);
      const wake = joinRequestLifecycleWake(armed(), context);
      const terminalContext = ctx(EXPIRES_AT);
      const expired = onJoinExpired(wake.state, {}, terminalContext);

      expect(expired.state).toEqual(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE);
      expect(context.intents.expireRequest).toHaveBeenCalledOnce();
      expect(terminalContext.intents.prepareNotification).toHaveBeenCalledWith(
        "join-notification:jreq_1:requestExpired",
        expect.objectContaining({
          kind: "requestExpired",
          requesterUserId: "user_sam",
        }),
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
