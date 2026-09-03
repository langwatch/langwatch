import { beforeEach, describe, expect, it, vi } from "vitest";
import { SsoArrivalService } from "../sso-arrival.service";
import type { SignInConnection } from "../sso-assertion.service";

/**
 * Whether the answer an administrator gave is the answer an arrival gets.
 *
 * The bug this pins is not a wrong answer, it is no answer: `arrivalPolicy`
 * was written, folded and rendered, and nothing on a sign-in path read it, so
 * every arrival through a self-serve connection got an account and nothing
 * else — no membership, no request, and an empty queue on the administrator's
 * screen. So each case asserts the CONSEQUENCE (a membership row, a request)
 * rather than that a branch was taken.
 */

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const USER = { id: "user_ana", email: "ana@acme.com", name: "Ana" };
const ORG = { id: "org_acme", name: "Acme" };

const connection = (
  over: Partial<SignInConnection> = {},
): SignInConnection => ({
  organizationId: ORG.id,
  state: "ACTIVE",
  arrivalPolicy: "request",
  verifiedDomains: ["acme.com"],
  lapsedDomains: [],
  createdBy: "user_ana",
  ...over,
});

/** What the membership write answers, which is the seam three cases turn on. */
type MembershipWrite = () => Promise<"created" | "already-present">;

const serviceOver = ({
  row,
  member = false,
  pendingInvite = null,
  membership = async () => "created",
}: {
  row: SignInConnection | null;
  member?: boolean;
  pendingInvite?: { inviteId: string } | null;
  membership?: MembershipWrite;
}) => {
  const createMembership = vi.fn(membership);
  const findConnectionForSignIn = vi.fn().mockResolvedValue(row);
  const requestFromSsoArrival = vi
    .fn()
    .mockResolvedValue({ joinRequestId: "jr_1" });
  const applyPendingInvite = vi.fn().mockResolvedValue(pendingInvite);
  const attachBindings = vi.fn().mockResolvedValue(undefined);
  const announceSignup = vi.fn();
  const startNurturing = vi.fn();

  return {
    service: new SsoArrivalService({
      connections: { findConnectionForSignIn },
      memberships: {
        findMembership: vi.fn().mockResolvedValue(member),
        createMembership,
        findOrganizationForMembership: vi.fn().mockResolvedValue(ORG),
      },
      invites: { applyPendingInvite },
      joinRequests: { requestFromSsoArrival },
      grants: { attachBindings },
      notifications: { announceSignup, startNurturing },
    }),
    findConnectionForSignIn,
    requestFromSsoArrival,
    applyPendingInvite,
    attachBindings,
    announceSignup,
    startNurturing,
    createMembership,
  };
};

const admit = (
  parts: ReturnType<typeof serviceOver>,
  domain = "acme.com",
): Promise<void> =>
  parts.service.admit({ user: USER, connectionId: CONNECTION_ID, domain });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given somebody arriving through a live connection on a domain it proved", () => {
  describe("when the answer is that they ask and an administrator approves", () => {
    /** @scenario "An arrival on a connection that asks keeps the account and waits" */
    it("stands a request to join, and makes them no member", async () => {
      const parts = serviceOver({ row: connection() });

      await admit(parts);

      expect(parts.requestFromSsoArrival).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        domain: "acme.com",
      });
      expect(parts.createMembership).not.toHaveBeenCalled();
    });
  });

  describe("when the answer is that they join automatically", () => {
    it("makes them a member and asks nobody", async () => {
      const parts = serviceOver({
        row: connection({ arrivalPolicy: "admit" }),
      });

      await admit(parts);

      expect(parts.createMembership).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
      });
      // The grant, not just the row: a membership without one is "in the
      // org" to legacy code and zero access under RBAC.
      expect(parts.attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_acme",
          onDuplicate: "skip",
          bindings: [
            expect.objectContaining({
              principal: { userId: "user_ana" },
              role: "MEMBER",
              scopeType: "ORGANIZATION",
              scopeId: "org_acme",
            }),
          ],
        }),
      );
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the answer is that nobody new gets in", () => {
    it("leaves them with the account and nothing else", async () => {
      const parts = serviceOver({
        row: connection({ arrivalPolicy: "refuse" }),
      });

      await admit(parts);

      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that must admit nobody new", () => {
  describe("when the domain's published record has lapsed", () => {
    /** ADR-123: a lapsed domain still routes, and stops provisioning. */
    it("admits nobody, though the connection is still live", async () => {
      const parts = serviceOver({
        row: connection({ lapsedDomains: ["acme.com"] }),
      });

      await admit(parts);

      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the connection is not on yet", () => {
    it("admits nobody", async () => {
      const parts = serviceOver({ row: connection({ state: "VERIFIED" }) });

      await admit(parts);

      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the address is on a domain it never proved", () => {
    it("admits nobody", async () => {
      const parts = serviceOver({ row: connection() });

      await admit(parts, "elsewhere.com");

      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when they are already a member", () => {
    it("asks nothing, which is every administrator testing their own connection", async () => {
      const parts = serviceOver({ row: connection(), member: true });

      await admit(parts);

      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });
});

describe("given an account that is not a connection at all", () => {
  describe("when it reaches the arrival seam", () => {
    it("does not ask the database about it", async () => {
      const parts = serviceOver({ row: null });

      await parts.service.admit({
        user: USER,
        connectionId: "google",
        domain: "acme.com",
      });

      expect(parts.findConnectionForSignIn).not.toHaveBeenCalled();
    });
  });
});

describe("given an arrival the join rules refuse for an ordinary reason", () => {
  describe("when the request is already in the queue", () => {
    it("swallows it, because the sign-in itself succeeded", async () => {
      const parts = serviceOver({ row: connection() });
      parts.requestFromSsoArrival.mockRejectedValue(
        Object.assign(new Error("already waiting"), {
          code: "join_request_already_pending",
        }),
      );

      await expect(admit(parts)).resolves.toBeUndefined();
    });
  });

  describe("when the membership write fails outright", () => {
    it("swallows it, because the account is already committed", async () => {
      const parts = serviceOver({
        row: connection({ arrivalPolicy: "admit" }),
        membership: () => Promise.reject(new Error("db down")),
      });

      await expect(admit(parts)).resolves.toBeUndefined();
    });
  });
});

describe("given a domain-matched organization to join", () => {
  describe("when a pending invite is waiting for that address", () => {
    it("applies it and writes no default membership", async () => {
      const parts = serviceOver({
        row: connection(),
        pendingInvite: { inviteId: "inv_1" },
      });

      await parts.service.joinOrganization({ user: USER, org: ORG });

      expect(parts.applyPendingInvite).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        email: "ana@acme.com",
      });
      // The invite's own role and team assignments carry their own grants,
      // so the default MEMBER pair must not run beside them.
      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.attachBindings).not.toHaveBeenCalled();
      expect(parts.announceSignup).toHaveBeenCalledWith({
        userName: "Ana",
        userEmail: "ana@acme.com",
        organizationName: "Acme",
      });
    });
  });

  describe("when no invite is waiting", () => {
    it("makes them a MEMBER, grants the organization scope and announces it", async () => {
      const parts = serviceOver({ row: connection() });

      await parts.service.joinOrganization({ user: USER, org: ORG });

      expect(parts.createMembership).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
      });
      expect(parts.attachBindings).toHaveBeenCalledTimes(1);
      expect(parts.startNurturing).toHaveBeenCalledWith({
        userId: "user_ana",
        email: "ana@acme.com",
        name: "Ana",
        organizationId: "org_acme",
        organizationName: "Acme",
      });
    });
  });

  describe("when a concurrent callback already created the membership row", () => {
    it("re-asserts the organization grant instead of assuming it landed", async () => {
      // The membership row and the grant beside it no longer share a
      // transaction, so the other callback may have died between them. The
      // row being there says nothing about the grant.
      const parts = serviceOver({
        row: connection(),
        membership: async () => "already-present",
      });

      await parts.service.joinOrganization({ user: USER, org: ORG });

      expect(parts.attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_acme",
          onDuplicate: "skip",
          bindings: [
            expect.objectContaining({
              principal: { userId: "user_ana" },
              role: "MEMBER",
              scopeType: "ORGANIZATION",
              scopeId: "org_acme",
            }),
          ],
        }),
      );
      // Nothing to announce: somebody else already did, or will.
      expect(parts.announceSignup).not.toHaveBeenCalled();
    });
  });
});
