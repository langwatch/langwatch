import { describe, expect, it } from "vitest";
import {
  emptyJoinRequest,
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_EXPIRED_EVENT_TYPE,
  JOIN_REJECTED_EVENT_TYPE,
  JOIN_REQUESTED_EVENT_TYPE,
  JOIN_WITHDRAWN_EVENT_TYPE,
  type JoinRequestAggregateState,
  type JoinRequestFact,
  reduceJoinRequest,
} from "../join-request";

/**
 * The fold, as the four endings.
 *
 * The reducer is total and pure, so these run the same function the queue's
 * fold and the replay proof run. What is worth asserting is the shape every
 * ending shares — the deadline is cleared, `resolvedAt` is the fact's business
 * time — and the one thing that distinguishes them, which is who ended it.
 *
 * Spec: specs/identity/join-requests.feature
 */

const REQUESTED_AT = 1_700_000_000_000;
const RESOLVED_AT = REQUESTED_AT + 60_000;
const EXPIRES_AT = REQUESTED_AT + 14 * 24 * 60 * 60 * 1000;

const requested: JoinRequestFact = {
  type: JOIN_REQUESTED_EVENT_TYPE,
  occurredAt: REQUESTED_AT,
  data: {
    joinRequestId: "jreq_1",
    userId: "user_sam",
    organizationId: "org_acme",
    domain: "acme.com",
    matchedVia: "verified-identifier-domain",
    expiresAtMs: EXPIRES_AT,
    actor: { type: "user", id: "user_sam" },
  },
};

const pending = (): JoinRequestAggregateState =>
  reduceJoinRequest({
    state: emptyJoinRequest({ joinRequestId: "jreq_1" }),
    fact: requested,
  });

describe("given nobody has asked yet", () => {
  describe("when the request is made", () => {
    it("records the domain and the deadline, and never the address", () => {
      const state = pending();

      expect(state).toMatchObject({
        joinRequestId: "jreq_1",
        userId: "user_sam",
        organizationId: "org_acme",
        domain: "acme.com",
        state: "PENDING",
        createdAtMs: REQUESTED_AT,
        expiresAtMs: EXPIRES_AT,
        resolvedAtMs: null,
      });
      // The DOMAIN is the fact. Nothing in the folded state carries the local
      // part of the address that produced it.
      expect(JSON.stringify(state)).not.toContain("sam@");
    });
  });
});

describe("given a pending request", () => {
  describe("when an administrator approves it", () => {
    /** @scenario One click makes the requester a member */
    it("records who resolved it and clears the deadline", () => {
      const state = reduceJoinRequest({
        state: pending(),
        fact: {
          type: JOIN_APPROVED_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            resolvedBy: { type: "user", id: "user_ana" },
            actor: { type: "user", id: "user_ana" },
          },
        },
      });

      expect(state).toMatchObject({
        state: "APPROVED",
        resolvedAtMs: RESOLVED_AT,
        resolvedByType: "user",
        resolvedById: "user_ana",
        expiresAtMs: null,
      });
    });
  });

  describe("when the domain policy approves it", () => {
    it("records the policy rather than a person", () => {
      const state = reduceJoinRequest({
        state: pending(),
        fact: {
          type: JOIN_APPROVED_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            resolvedBy: { type: "policy", id: "domain-auto" },
            actor: { type: "system", id: "system:join-requests" },
          },
        },
      });

      // "How did this person get in?" has to be answerable, and a policy
      // admitting somebody is a different answer from a colleague doing it.
      expect(state.resolvedByType).toBe("policy");
      expect(state.resolvedById).toBe("domain-auto");
    });
  });

  describe("when an administrator rejects it", () => {
    /** @scenario A rejection ends the request without asking for a reason */
    it("records the ending without a reason of any kind", () => {
      const state = reduceJoinRequest({
        state: pending(),
        fact: {
          type: JOIN_REJECTED_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            resolvedBy: { type: "user", id: "user_ana" },
            actor: { type: "user", id: "user_ana" },
          },
        },
      });

      expect(state).toMatchObject({
        state: "REJECTED",
        resolvedAtMs: RESOLVED_AT,
        expiresAtMs: null,
      });
      // There is no reason field to carry one, which is the point: an admin
      // who has to justify a refusal is an admin who hesitates to make one.
      expect(state).not.toHaveProperty("rejectionReason");
    });
  });

  describe("when the requester withdraws it", () => {
    /** @scenario The requester can withdraw and stop bothering anybody */
    it("records the cause so an invitation crossing it is distinguishable", () => {
      const byUser = reduceJoinRequest({
        state: pending(),
        fact: {
          type: JOIN_WITHDRAWN_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            cause: "user",
            actor: { type: "user", id: "user_sam" },
          },
        },
      });
      const byInvite = reduceJoinRequest({
        state: pending(),
        fact: {
          type: JOIN_WITHDRAWN_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            cause: "invite-accepted",
            actor: { type: "system", id: "system:join-requests" },
          },
        },
      });

      expect(byUser).toMatchObject({
        state: "WITHDRAWN",
        withdrawalCause: "user",
        expiresAtMs: null,
      });
      expect(byInvite.withdrawalCause).toBe("invite-accepted");
    });
  });

  describe("when the window elapses with nobody answering", () => {
    /** @scenario Fourteen days of silence expires the request */
    it("expires at the deadline it promised, not when the worker ran", () => {
      const state = reduceJoinRequest({
        state: pending(),
        fact: {
          type: JOIN_EXPIRED_EVENT_TYPE,
          // Business time is the slot the wake was scheduled for, so a lagged
          // worker does not move the ending the requester was promised.
          occurredAt: EXPIRES_AT,
          data: {
            joinRequestId: "jreq_1",
            actor: { type: "system", id: "system:join-requests" },
          },
        },
      });

      expect(state).toMatchObject({
        state: "EXPIRED",
        resolvedAtMs: EXPIRES_AT,
        expiresAtMs: null,
      });
    });
  });
});

describe("given a request that reached any ending", () => {
  describe("when the endings are compared", () => {
    it("clears the deadline on every one of them", () => {
      const endings: JoinRequestFact[] = [
        {
          type: JOIN_APPROVED_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            resolvedBy: { type: "user", id: "user_ana" },
            actor: { type: "user", id: "user_ana" },
          },
        },
        {
          type: JOIN_REJECTED_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            resolvedBy: { type: "user", id: "user_ana" },
            actor: { type: "user", id: "user_ana" },
          },
        },
        {
          type: JOIN_EXPIRED_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            actor: { type: "system", id: "system:join-requests" },
          },
        },
        {
          type: JOIN_WITHDRAWN_EVENT_TYPE,
          occurredAt: RESOLVED_AT,
          data: {
            joinRequestId: "jreq_1",
            cause: "user",
            actor: { type: "user", id: "user_sam" },
          },
        },
      ];

      for (const fact of endings) {
        const state = reduceJoinRequest({ state: pending(), fact });
        // Nothing left to wake for: the process manager disarms on each of
        // these, and a state that still carried a deadline would be a request
        // the expiry wake could act on after it ended.
        expect(state.expiresAtMs).toBeNull();
        expect(state.resolvedAtMs).toBe(RESOLVED_AT);
        expect(state.state).not.toBe("PENDING");
      }
    });
  });
});
