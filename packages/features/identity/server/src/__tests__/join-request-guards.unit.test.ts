import {
  emptyJoinRequest,
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_EXPIRED_EVENT_TYPE,
  JOIN_REQUESTED_EVENT_TYPE,
  type JoinRequestAggregateState,
  type JoinRequestState,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { JoinRequestGuards } from "../join-request-guards";
import type { JoinRequestReadRepository } from "../join-request.repository";

/**
 * What a guard refuses before any fact exists.
 *
 * Assertions are on `code`, never on message prose: every refusal here
 * crosses a serialisation boundary on its way to a customer, and the words
 * are copy that will change.
 *
 * Spec: specs/identity/join-requests.feature
 */

const EXPIRES_AT = 1_700_000_000_000;

class FakeRequests implements JoinRequestReadRepository {
  held: JoinRequestAggregateState | null = null;
  pending: JoinRequestAggregateState | null = null;

  async findRequest(): Promise<JoinRequestAggregateState | null> {
    return this.held;
  }

  async findPendingRequest(): Promise<JoinRequestAggregateState | null> {
    return this.pending;
  }
}

const stateIn = (
  state: JoinRequestState,
  overrides: Partial<JoinRequestAggregateState> = {},
): JoinRequestAggregateState => ({
  ...emptyJoinRequest({ joinRequestId: "jreq_1" }),
  userId: "user_sam",
  organizationId: "org_acme",
  domain: "acme.com",
  state,
  expiresAtMs: state === "PENDING" ? EXPIRES_AT : null,
  ...overrides,
});

const command = {
  tenantId: "org_acme",
  organizationId: "org_acme",
  joinRequestId: "jreq_1",
  commandId: "cmd_1",
  occurredAtMs: 1_699_000_000_000,
  actor: { type: "user" as const, id: "user_ana" },
};

describe("given nobody has asked yet", () => {
  let requests: FakeRequests;
  let guards: JoinRequestGuards;

  beforeEach(() => {
    requests = new FakeRequests();
    guards = new JoinRequestGuards({ requests });
  });

  describe("when somebody asks on a company domain", () => {
    /** @scenario A verified colleague asks to join and the admins are told */
    it("states the request with the normalized domain", async () => {
      const facts = await guards.requestJoin({
        ...command,
        actor: { type: "user", id: "user_sam" },
        userId: "user_sam",
        domain: "  ACME.com. ",
        matchedVia: "verified-identifier-domain",
        expiresAtMs: EXPIRES_AT,
      });

      expect(facts).toHaveLength(1);
      expect(facts[0]?.type).toBe(JOIN_REQUESTED_EVENT_TYPE);
      // The guard folds the domain rather than trusting the caller's spelling,
      // so the fact and a later lookup compare byte for byte.
      expect(facts[0]?.data).toMatchObject({ domain: "acme.com" });
    });
  });

  describe("when somebody asks on a public email domain", () => {
    /** @scenario A public email domain matches nothing, in any mode */
    it("refuses with the same nothing every closed door gives", async () => {
      await expect(
        guards.requestJoin({
          ...command,
          userId: "user_sam",
          domain: "gmail.com",
          matchedVia: "verified-identifier-domain",
          expiresAtMs: EXPIRES_AT,
        }),
      ).rejects.toMatchObject({ code: "join_not_available" });
    });
  });

  describe("when the same person already has a request open", () => {
    /** @scenario One open request per person per organization */
    it("refuses the second ask", async () => {
      requests.pending = stateIn("PENDING");

      await expect(
        guards.requestJoin({
          ...command,
          joinRequestId: "jreq_2",
          userId: "user_sam",
          domain: "acme.com",
          matchedVia: "verified-identifier-domain",
          expiresAtMs: EXPIRES_AT,
        }),
      ).rejects.toMatchObject({ code: "join_request_already_pending" });
    });
  });

  describe("when the same command is retried", () => {
    it("states nothing, because the request already exists", async () => {
      requests.held = stateIn("PENDING");

      const facts = await guards.requestJoin({
        ...command,
        userId: "user_sam",
        domain: "acme.com",
        matchedVia: "verified-identifier-domain",
        expiresAtMs: EXPIRES_AT,
      });

      expect(facts).toEqual([]);
    });
  });
});

describe("given a pending request", () => {
  let requests: FakeRequests;
  let guards: JoinRequestGuards;

  beforeEach(() => {
    requests = new FakeRequests();
    requests.held = stateIn("PENDING");
    guards = new JoinRequestGuards({ requests });
  });

  describe("when an administrator approves it", () => {
    it("states the approval with the resolver on it", async () => {
      const facts = await guards.approveJoin({
        ...command,
        resolvedBy: { type: "user", id: "user_ana" },
      });

      expect(facts).toHaveLength(1);
      expect(facts[0]?.type).toBe(JOIN_APPROVED_EVENT_TYPE);
      expect(facts[0]?.data).toMatchObject({
        resolvedBy: { type: "user", id: "user_ana" },
      });
    });
  });

  describe("when the expiry wake fires before the deadline", () => {
    it("expires nothing, because the guard re-reads the deadline", async () => {
      const facts = await guards.expireJoin({
        ...command,
        scheduledFor: EXPIRES_AT - 1,
      });

      expect(facts).toEqual([]);
    });
  });

  describe("when the expiry wake fires at the deadline", () => {
    /** @scenario Fourteen days of silence expires the request */
    it("states the expiry", async () => {
      const facts = await guards.expireJoin({
        ...command,
        scheduledFor: EXPIRES_AT,
      });

      expect(facts).toHaveLength(1);
      expect(facts[0]?.type).toBe(JOIN_EXPIRED_EVENT_TYPE);
    });
  });
});

describe("given a request that already ended", () => {
  describe("when anybody tries to answer it again", () => {
    /** @scenario Every ending is terminal */
    it("refuses approve, reject and withdraw on all three endings", async () => {
      for (const ended of ["REJECTED", "EXPIRED", "WITHDRAWN"] as const) {
        const requests = new FakeRequests();
        requests.held = stateIn(ended);
        const guards = new JoinRequestGuards({ requests });

        await expect(
          guards.approveJoin({
            ...command,
            resolvedBy: { type: "user", id: "user_ana" },
          }),
        ).rejects.toMatchObject({ code: "join_request_not_pending" });
        await expect(
          guards.rejectJoin({
            ...command,
            resolvedBy: { type: "user", id: "user_ana" },
          }),
        ).rejects.toMatchObject({ code: "join_request_not_pending" });
        await expect(guards.withdrawJoin({ ...command, cause: "user" })).rejects.toMatchObject({
          code: "join_request_not_pending",
        });
      }
    });

    it("expires nothing rather than refusing, because no person is waiting", async () => {
      const requests = new FakeRequests();
      requests.held = stateIn("APPROVED");
      const guards = new JoinRequestGuards({ requests });

      // A wake is not somebody to refuse: the request ended by another route
      // and there is nothing left to do.
      expect(await guards.expireJoin({ ...command, scheduledFor: EXPIRES_AT })).toEqual([]);
    });
  });
});

describe("given an approval that already landed", () => {
  describe("when the same resolver's approval is retried", () => {
    /** @scenario A replayed approval attaches membership exactly once */
    it("states nothing rather than approving twice", async () => {
      const requests = new FakeRequests();
      requests.held = stateIn("APPROVED", {
        resolvedByType: "user",
        resolvedById: "user_ana",
      });
      const guards = new JoinRequestGuards({ requests });

      // The retry leg. The membership attach behind it is idempotent too, so
      // a retry after a partial failure finishes the job rather than leaving
      // a request approved with nobody in the organization.
      expect(
        await guards.approveJoin({
          ...command,
          resolvedBy: { type: "user", id: "user_ana" },
        }),
      ).toEqual([]);
    });
  });

  describe("when a DIFFERENT resolver tries to approve it", () => {
    it("refuses, because the request is no longer pending", async () => {
      const requests = new FakeRequests();
      requests.held = stateIn("APPROVED", {
        resolvedByType: "user",
        resolvedById: "user_ana",
      });
      const guards = new JoinRequestGuards({ requests });

      await expect(
        guards.approveJoin({
          ...command,
          resolvedBy: { type: "user", id: "user_other" },
        }),
      ).rejects.toMatchObject({ code: "join_request_not_pending" });
    });
  });
});
