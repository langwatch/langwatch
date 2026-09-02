import type { JoinRequestFact } from "@langwatch/identity-contract";
import type {
  JoinRequestNotificationService,
  JoinRequestService,
} from "@langwatch/identity-server";
import { describe, expect, it, vi } from "vitest";
import { EventingJoinRequestLifecycleAdapter } from "../eventing.join-request-lifecycle.adapter";

/**
 * Spec: packages/features/identity/specs/join-request-worker-composition.feature
 */
const ORGANIZATION = "organization_acme";
const REQUEST = "joinreq_1";
const REQUESTER = "user_ada";

function compose(input: { facts?: JoinRequestFact[]; request?: { userId: string } | null } = {}) {
  const order: string[] = [];
  const expireJoin = vi.fn(async () => {
    order.push("expireJoin");
    return input.facts ?? ([{ type: "lw.identity.join_expired" }] as unknown as JoinRequestFact[]);
  });
  const findRequest = vi.fn(async () => {
    order.push("findRequest");
    return input.request === undefined ? { userId: REQUESTER } : input.request;
  });
  const requestStillWaiting = vi.fn(async () => void 0);
  const requestExpired = vi.fn(async () => void 0);

  const adapter = EventingJoinRequestLifecycleAdapter.create({
    requests: { expireJoin } as unknown as JoinRequestService,
    reads: { findRequest } as never,
    notifications: {
      requestStillWaiting,
      requestExpired,
    } as unknown as JoinRequestNotificationService,
  });
  return { adapter, expireJoin, findRequest, requestStillWaiting, requestExpired, order };
}

describe("given a composed join-request pipeline", () => {
  describe("when the reminder wake fires", () => {
    it("asks the notification service for the one nudge", async () => {
      /** @scenario "One bouncing admin address does not silence the rest" */
      const { adapter, requestStillWaiting } = compose();

      await adapter.remindAdmins({ joinRequestId: REQUEST, organizationId: ORGANIZATION });

      expect(requestStillWaiting).toHaveBeenCalledWith({
        joinRequestId: REQUEST,
        organizationId: ORGANIZATION,
      });
    });
  });

  describe("when the expiry wake fires", () => {
    /** @scenario "The expiry wake dispatches a command rather than writing the row" */
    it("dispatches the guarded command as the system actor", async () => {
      const { adapter, expireJoin } = compose();

      await adapter.expireRequest({
        joinRequestId: REQUEST,
        organizationId: ORGANIZATION,
        occurredAtMs: 1_700_000_000_000,
      });

      // A command rather than a projection write: the process manager decides
      // WHEN, the guard still decides WHETHER, and it re-reads the folded
      // deadline so a wake that fires early expires nothing.
      expect(expireJoin).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: ORGANIZATION,
          organizationId: ORGANIZATION,
          joinRequestId: REQUEST,
          occurredAtMs: 1_700_000_000_000,
          scheduledFor: 1_700_000_000_000,
          actor: { type: "system", id: "system:join-requests" },
        }),
      );
    });

    /** @scenario "The expiry wake dispatches a command rather than writing the row" */
    it("reads the requester before the command, not after it", async () => {
      const { adapter, order } = compose();

      await adapter.expireRequest({
        joinRequestId: REQUEST,
        organizationId: ORGANIZATION,
        occurredAtMs: 1_700_000_000_000,
      });

      // The fold that follows the command is the only thing that changes here,
      // so reading first keeps "who do we tell" independent of when the
      // projection catches up.
      expect(order).toEqual(["findRequest", "expireJoin"]);
    });

    /** @scenario "The expiry wake dispatches a command rather than writing the row" */
    it("tells the requester only when something actually expired", async () => {
      const expired = compose();
      await expired.adapter.expireRequest({
        joinRequestId: REQUEST,
        organizationId: ORGANIZATION,
        occurredAtMs: 1_700_000_000_000,
      });
      expect(expired.requestExpired).toHaveBeenCalledWith({
        joinRequestId: REQUEST,
        organizationId: ORGANIZATION,
        requesterUserId: REQUESTER,
      });

      // A wake that fired early, or one for a request an admin answered in the
      // meantime, states nothing — and telling somebody their request lapsed
      // when it did not would be worse than telling them nothing.
      const stated = compose({ facts: [] });
      await stated.adapter.expireRequest({
        joinRequestId: REQUEST,
        organizationId: ORGANIZATION,
        occurredAtMs: 1_700_000_000_000,
      });
      expect(stated.requestExpired).not.toHaveBeenCalled();
    });

    /** @scenario "A notification with nobody to address is not sent" */
    it("tells nobody when the request row cannot be read", async () => {
      const { adapter, requestExpired } = compose({ request: null });

      await adapter.expireRequest({
        joinRequestId: REQUEST,
        organizationId: ORGANIZATION,
        occurredAtMs: 1_700_000_000_000,
      });

      expect(requestExpired).not.toHaveBeenCalled();
    });
  });
});
