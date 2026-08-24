import { describe, expect, it, vi } from "vitest";
import {
  JOIN_REQUEST_EXPIRY_MS,
  JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
  JOIN_REQUEST_REMINDER_MS,
  type JoinRequestLifecycleState,
  joinRequestLifecycleWake,
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

const ctx = (at: number) => ({
  at,
  now: at,
  key: "jreq_1",
  projectId: "org_acme",
  intents: {
    remindAdmins: vi.fn((dedupe: string, payload: unknown) => ({
      name: "remindAdmins",
      dedupe,
      payload,
    })),
    expireRequest: vi.fn((dedupe: string, payload: unknown) => ({
      name: "expireRequest",
      dedupe,
      payload,
    })),
  },
});

const armed = (): JoinRequestLifecycleState =>
  onJoinRequested(
    JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
    { expiresAtMs: EXPIRES_AT },
    ctx(REQUESTED_AT) as never,
  ).state;

describe("given a request has just been made", () => {
  describe("when the process arms its deadlines", () => {
    it("wakes first at the halfway mark, not at the expiry", () => {
      const evolution = onJoinRequested(
        JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
        { expiresAtMs: EXPIRES_AT },
        ctx(REQUESTED_AT) as never,
      );

      expect(evolution.nextWakeAt).toBe(REMIND_AT);
      expect(evolution.state).toEqual({
        remindAtMs: REMIND_AT,
        expiresAtMs: EXPIRES_AT,
        remindedAt: null,
      });
    });

    it("skips straight to the expiry when the window is shorter than the gap", () => {
      const soon = REQUESTED_AT + 60_000;
      const evolution = onJoinRequested(
        JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
        { expiresAtMs: soon },
        ctx(REQUESTED_AT) as never,
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
      const evolution = joinRequestLifecycleWake(armed(), context as never);

      expect(evolution.intents).toHaveLength(1);
      expect(context.intents.remindAdmins).toHaveBeenCalledOnce();
      expect(evolution.nextWakeAt).toBe(EXPIRES_AT);
      expect(evolution.state.remindedAt).toBe(REMIND_AT);
    });

    it("does not remind twice when the wake is redelivered", () => {
      const reminded = joinRequestLifecycleWake(
        armed(),
        ctx(REMIND_AT) as never,
      ).state;

      const context = ctx(REMIND_AT + 1000);
      const evolution = joinRequestLifecycleWake(reminded, context as never);

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
      const evolution = joinRequestLifecycleWake(armed(), context as never);

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
      expect(evolution.state).toEqual(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE);
    });

    it("expires at the promised deadline even when the wake runs late", () => {
      const context = ctx(EXPIRES_AT + 3 * 60 * 60 * 1000);
      joinRequestLifecycleWake(armed(), context as never);

      expect(context.intents.expireRequest).toHaveBeenCalledWith(
        `join-expire:${EXPIRES_AT}`,
        expect.objectContaining({ scheduledFor: EXPIRES_AT }),
      );
    });
  });
});

describe("given a request that reached an ending", () => {
  describe("when the process sees the ending", () => {
    /** @scenario The requester withdraws while it is still pending */
    it("disarms, so no reminder and no expiry wake follows", () => {
      const evolution = onJoinResolved(armed(), {}, ctx(REQUESTED_AT) as never);

      expect(evolution.nextWakeAt).toBeNull();
      expect(evolution.state).toEqual(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE);

      // And a wake that somehow still fired does nothing at all.
      const context = ctx(EXPIRES_AT);
      const afterwards = joinRequestLifecycleWake(
        evolution.state,
        context as never,
      );
      expect(context.intents.expireRequest).not.toHaveBeenCalled();
      expect(context.intents.remindAdmins).not.toHaveBeenCalled();
      expect(afterwards.nextWakeAt).toBeNull();
    });
  });
});
