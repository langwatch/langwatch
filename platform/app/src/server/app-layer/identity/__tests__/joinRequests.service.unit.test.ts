import type {
  DomainJoinSetting,
  JoinCandidateOrganization,
  JoinRequestAggregateState,
} from "@langwatch/identity";
import { emptyJoinRequest } from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true, remaining: 5, resetAt: Date.now() })),
);
vi.mock("~/server/rateLimit", () => ({ rateLimit: rateLimitMock }));

import {
  JOIN_REJECTION_COOLDOWN_MS,
  type JoinMembershipPort,
  type JoinRequestNotifier,
  JoinRequestsService,
  type JoinSettingPort,
} from "../join-requests.service";

/**
 * Everything AROUND the lifecycle: the reveal discipline at the boundary, the
 * anti-abuse limits, the licence asymmetry, and how an approval becomes a
 * membership.
 *
 * Assertions are on `code`, never on message prose — every refusal here
 * crosses a serialisation boundary on its way to a customer.
 *
 * Spec: specs/identity/join-requests.feature,
 *       specs/identity/join-matching-and-privacy.feature,
 *       specs/identity/domain-auto-join.feature
 */

const NOW = 1_700_000_000_000;

const acme: JoinCandidateOrganization = {
  organizationId: "org_acme",
  name: "Acme",
  domainJoin: "request",
  connectionAdmitsDomain: false,
  verifiedMembersOnDomain: 3,
  memberCount: 117,
  autoJoinDomains: [],
};

const pendingState = (
  overrides: Partial<JoinRequestAggregateState> = {},
): JoinRequestAggregateState => ({
  ...emptyJoinRequest({ joinRequestId: "jreq_1" }),
  userId: "user_sam",
  organizationId: "org_acme",
  domain: "acme.com",
  state: "PENDING",
  ...overrides,
});

function harness({
  candidates = [acme],
  held = null,
  pending = null,
  lastRejectionAt = null,
  licensed = true,
  enabled = true,
  isMember = false,
  setting = { domainJoin: "request" as DomainJoinSetting, joinDomains: [] },
}: {
  candidates?: JoinCandidateOrganization[];
  held?: JoinRequestAggregateState | null;
  pending?: JoinRequestAggregateState | null;
  lastRejectionAt?: Date | null;
  licensed?: boolean;
  enabled?: boolean;
  isMember?: boolean;
  setting?: { domainJoin: DomainJoinSetting; joinDomains: string[] };
} = {}) {
  const requests = {
    requestJoin: vi.fn(async () => []),
    approveJoin: vi.fn(async () => []),
    rejectJoin: vi.fn(async () => []),
    withdrawJoin: vi.fn(async () => []),
    expireJoin: vi.fn(async () => []),
  };
  const membership: JoinMembershipPort = {
    attachDefaultMembership: vi.fn(async () => undefined),
    isMember: vi.fn(async () => isMember),
  };
  const notifier = {
    requestArrived: vi.fn(async () => undefined),
    requestStillWaiting: vi.fn(async () => undefined),
    requestApproved: vi.fn(async () => undefined),
    requestRejected: vi.fn(async () => undefined),
    requestExpired: vi.fn(async () => undefined),
    joinedAutomatically: vi.fn(async () => undefined),
  } satisfies JoinRequestNotifier;
  const settings: JoinSettingPort = {
    read: vi.fn(async () => setting),
    write: vi.fn(async () => undefined),
  };
  const reads = {
    findRequest: vi.fn(async () => held),
    findPendingRequest: vi.fn(async () => pending),
    findLastRejectionAt: vi.fn(async () => lastRejectionAt),
    findPendingForOrganization: vi.fn(async () => []),
    findPendingForUser: vi.fn(async () => []),
  };

  const service = new JoinRequestsService({
    requests: requests as never,
    reads: reads as never,
    candidates: {
      findCandidateOrganizations: vi.fn(async () => candidates),
      findCandidateOrganization: vi.fn(
        async ({ organizationId }: { organizationId: string }) =>
          candidates.find(
            (candidate) => candidate.organizationId === organizationId,
          ) ?? null,
      ),
    },
    membership,
    notifier,
    settings,
    autoJoinLicensed: async () => licensed,
    enabled: async () => enabled,
    now: () => NOW,
  });

  return { service, requests, membership, notifier, settings, reads };
}

beforeEach(() => {
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({
    allowed: true,
    remaining: 5,
    resetAt: NOW + 60_000,
  });
});

describe("given the join-requests flag is off", () => {
  describe("when somebody looks up or asks", () => {
    /** @scenario With the flag off nothing here exists */
    it("answers nothing and refuses the ask", async () => {
      const { service, requests } = harness({ enabled: false });

      expect(
        await service.lookup({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
        }),
      ).toEqual({ outcome: "none" });
      await expect(
        service.request({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
          organizationId: "org_acme",
        }),
      ).rejects.toMatchObject({ code: "join_not_available" });
      expect(requests.requestJoin).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization that was never offered", () => {
  describe("when it is named directly", () => {
    /** @scenario Asking for an organization that was never offered is refused as if it did not exist */
    it("refuses with the same code an unknown organization gives", async () => {
      const { service } = harness({ candidates: [] });

      await expect(
        service.request({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
          organizationId: "org_secret",
        }),
      ).rejects.toMatchObject({ code: "join_not_available" });
    });

    it("refuses an organization that turned joining off identically", async () => {
      const { service } = harness({
        candidates: [{ ...acme, domainJoin: "off" }],
      });

      await expect(
        service.request({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
          organizationId: "org_acme",
        }),
      ).rejects.toMatchObject({ code: "join_not_available" });
    });
  });
});

describe("given somebody asking too often", () => {
  describe("when the limiter refuses", () => {
    /** @scenario Asking is rate limited the way signing in is */
    it("refuses with the throttle code and says how long is left", async () => {
      rateLimitMock.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 90_000,
      });
      const { service } = harness();

      await expect(
        service.request({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
          organizationId: "org_acme",
        }),
      ).rejects.toMatchObject({
        code: "join_request_throttled",
        // Read off the limiter's own answer, not guessed.
        meta: { retryAfterSeconds: expect.any(Number) },
      });
    });
  });
});

describe("given a person an administrator has rejected", () => {
  describe("when they ask again inside the cool-down", () => {
    /** @scenario A rejected person cannot immediately ask again */
    it("refuses with the throttle code, never a rejection code", async () => {
      const { service } = harness({
        lastRejectionAt: new Date(NOW - 60_000),
      });

      // The THROTTLE code on purpose: a person who could tell "you were
      // rejected" from "you are going too fast" has been told the rejection
      // the silent-ish ending keeps quiet.
      await expect(
        service.request({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
          organizationId: "org_acme",
        }),
      ).rejects.toMatchObject({ code: "join_request_throttled" });
    });
  });

  describe("when they ask after the cool-down", () => {
    it("opens a fresh request", async () => {
      const { service, requests } = harness({
        lastRejectionAt: new Date(NOW - JOIN_REJECTION_COOLDOWN_MS - 1),
      });

      const result = await service.request({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
        organizationId: "org_acme",
      });

      expect(result.state).toBe("PENDING");
      expect(requests.requestJoin).toHaveBeenCalledOnce();
    });
  });
});

describe("given an administrator approving a request", () => {
  describe("when the requester is not yet a member", () => {
    /** @scenario Membership lands through the same ledger an invitation uses */
    it("states the approval, then attaches the membership", async () => {
      const { service, requests, membership, notifier } = harness({
        held: pendingState(),
      });

      await service.approve({
        joinRequestId: "jreq_1",
        organizationId: "org_acme",
        adminUserId: "user_ana",
      });

      expect(requests.approveJoin).toHaveBeenCalledWith(
        expect.objectContaining({
          joinRequestId: "jreq_1",
          resolvedBy: { type: "user", id: "user_ana" },
          // Derived, not minted: a retry after a partial failure has to be
          // the SAME command.
          commandId: "join-approve:jreq_1:user:user_ana",
        }),
      );
      expect(membership.attachDefaultMembership).toHaveBeenCalledWith({
        userId: "user_sam",
        organizationId: "org_acme",
        approvedByUserId: "user_ana",
      });
      expect(notifier.requestApproved).toHaveBeenCalledOnce();
    });
  });

  describe("when the requester joined by invitation while it was open", () => {
    /** @scenario Approving somebody who is already a member resolves the request and adds nothing */
    it("resolves the request and attaches no second membership", async () => {
      const { service, requests, membership } = harness({
        held: pendingState(),
        isMember: true,
      });

      await service.approve({
        joinRequestId: "jreq_1",
        organizationId: "org_acme",
        adminUserId: "user_ana",
      });

      expect(requests.approveJoin).toHaveBeenCalledOnce();
      expect(membership.attachDefaultMembership).not.toHaveBeenCalled();
    });
  });

  describe("when the request belongs to another organization", () => {
    /** @scenario A request from another organization is not there to answer */
    it("refuses without revealing anything about the other organization", async () => {
      const { service, requests } = harness({
        held: pendingState({ organizationId: "org_elsewhere" }),
      });

      await expect(
        service.approve({
          joinRequestId: "jreq_1",
          organizationId: "org_acme",
          adminUserId: "user_ana",
        }),
      ).rejects.toMatchObject({ code: "join_request_not_found" });
      expect(requests.approveJoin).not.toHaveBeenCalled();
    });
  });
});

describe("given an administrator rejecting a request", () => {
  describe("when they reject it", () => {
    it("records no reason and tells the requester nothing about who decided", async () => {
      const { service, requests, notifier } = harness({ held: pendingState() });

      await service.reject({
        joinRequestId: "jreq_1",
        organizationId: "org_acme",
        adminUserId: "user_ana",
      });

      const [command] = requests.rejectJoin.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(command).not.toHaveProperty("reason");
      // The notifier is told WHO to tell, and nothing about the rejector
      // reaches the requester's mail.
      expect(notifier.requestRejected).toHaveBeenCalledWith({
        joinRequestId: "jreq_1",
        organizationId: "org_acme",
        requesterUserId: "user_sam",
      });
    });
  });
});

describe("given a domain that admits colleagues automatically", () => {
  describe("when a verified colleague arrives", () => {
    /** @scenario A verified colleague joins an opted-in organization immediately */
    it("makes the request and approves it by policy in one move", async () => {
      const { service, requests, membership, notifier } = harness({
        candidates: [
          {
            ...acme,
            domainJoin: "auto",
            autoJoinDomains: ["acme.com"],
            verifiedMembersOnDomain: 2,
          },
        ],
      });

      const joined = await service.joinAutomaticallyIfAdmitted({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });

      expect(joined?.organization.organizationId).toBe("org_acme");
      // Not a second mechanism: the same request, approved by policy the
      // moment it is made. What differs is only who resolves it.
      expect(requests.requestJoin).toHaveBeenCalledOnce();
      expect(requests.approveJoin).toHaveBeenCalledWith(
        expect.objectContaining({
          resolvedBy: { type: "policy", id: "domain-auto" },
        }),
      );
      expect(membership.attachDefaultMembership).toHaveBeenCalledWith({
        userId: "user_sam",
        organizationId: "org_acme",
        approvedByUserId: null,
      });
      // A surprising join has to be visible the moment it happens.
      expect(notifier.joinedAutomatically).toHaveBeenCalledOnce();
    });
  });

  describe("when the deployment is unlicensed", () => {
    /** @scenario Losing the license stops automatic joining without stranding members */
    it("admits nobody automatically and leaves asking available", async () => {
      const { service, requests } = harness({
        licensed: false,
        candidates: [
          {
            ...acme,
            domainJoin: "auto",
            autoJoinDomains: ["acme.com"],
            verifiedMembersOnDomain: 4,
          },
        ],
      });

      expect(
        await service.joinAutomaticallyIfAdmitted({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
        }),
      ).toBeNull();
      expect(requests.approveJoin).not.toHaveBeenCalled();

      // Asking still works: the gate holds `auto` and lets `request` through.
      const decision = await service.lookup({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });
      expect(decision.outcome).toBe("ask");
    });
  });
});

describe("given an administrator turning automatic joining on", () => {
  describe("when the deployment is unlicensed", () => {
    /** @scenario An unlicensed deployment cannot turn automatic joining on */
    it("refuses, and asking to join stays available", async () => {
      const { service, settings } = harness({ licensed: false });

      await expect(
        service.setJoining({
          organizationId: "org_acme",
          domainJoin: "auto",
          domains: ["acme.com"],
        }),
      ).rejects.toMatchObject({ code: "join_auto_not_licensed" });
      expect(settings.write).not.toHaveBeenCalled();
    });
  });

  describe("when the domain is a public email provider", () => {
    /** @scenario A public email domain cannot be turned on at all */
    it("refuses without listing what counts as one", async () => {
      const { service } = harness();

      await expect(
        service.setJoining({
          organizationId: "org_acme",
          domainJoin: "auto",
          domains: ["gmail.com"],
        }),
      ).rejects.toMatchObject({ code: "join_auto_domain_unproven" });
    });
  });

  describe("when only one member has verified the domain", () => {
    /** @scenario Turning it on names the domain and needs corroboration */
    it("refuses until a second verified member corroborates it", async () => {
      const { service } = harness({
        candidates: [{ ...acme, verifiedMembersOnDomain: 1 }],
      });

      await expect(
        service.setJoining({
          organizationId: "org_acme",
          domainJoin: "auto",
          domains: ["acme.com"],
        }),
      ).rejects.toMatchObject({ code: "join_auto_domain_unproven" });
    });
  });

  describe("when an identity provider already admits the domain", () => {
    /** @scenario An organization whose identity provider admits people cannot turn it on */
    it("refuses, because the connection's own provisioning is the way in", async () => {
      const { service } = harness({
        candidates: [{ ...acme, connectionAdmitsDomain: true }],
      });

      await expect(
        service.setJoining({
          organizationId: "org_acme",
          domainJoin: "auto",
          domains: ["acme.com"],
        }),
      ).rejects.toMatchObject({ code: "join_auto_connection_admits" });
    });
  });

  describe("when everything checks out", () => {
    it("saves the setting with the named domain", async () => {
      const { service, settings } = harness();

      const result = await service.setJoining({
        organizationId: "org_acme",
        domainJoin: "auto",
        domains: ["  ACME.com "],
      });

      expect(settings.write).toHaveBeenCalledWith({
        organizationId: "org_acme",
        domainJoin: "auto",
        joinDomains: ["acme.com"],
      });
      expect(result).toEqual({ previous: "request", next: "auto" });
    });
  });

  describe("when it is turned back off", () => {
    /** @scenario Turning it off stops future joins and touches nobody already in */
    it("clears the domains it named", async () => {
      const { service, settings } = harness({
        setting: { domainJoin: "auto", joinDomains: ["acme.com"] },
      });

      await service.setJoining({
        organizationId: "org_acme",
        domainJoin: "request",
        domains: ["acme.com"],
      });

      // A setting flipped back on later must name its domains again,
      // deliberately, rather than inherit a decision from months ago.
      expect(settings.write).toHaveBeenCalledWith({
        organizationId: "org_acme",
        domainJoin: "request",
        joinDomains: [],
      });
    });
  });
});

describe("given a pending request and an invitation crossing it", () => {
  describe("when an administrator sends a formal invitation", () => {
    /** @scenario An invitation answers a pending request and supersedes it */
    it("resolves the request as approved by the invitation, attaching nothing", async () => {
      const { service, requests, membership } = harness({
        pending: pendingState(),
      });

      await service.resolveByInvitation({
        userId: "user_sam",
        organizationId: "org_acme",
        inviteId: "inv_1",
      });

      expect(requests.approveJoin).toHaveBeenCalledWith(
        expect.objectContaining({
          resolvedBy: { type: "invite", id: "inv_1" },
        }),
      );
      // The invitation's own acceptance attaches membership, with the role
      // and teams IT carries. This only closes the request.
      expect(membership.attachDefaultMembership).not.toHaveBeenCalled();
    });
  });

  describe("when the person accepts an invitation instead", () => {
    /** @scenario Accepting any invitation withdraws the same person's pending request */
    it("withdraws the request, naming the invitation as the cause", async () => {
      const { service, requests } = harness({ pending: pendingState() });

      await service.withdrawOnInvitationAccepted({
        userId: "user_sam",
        organizationId: "org_acme",
      });

      expect(requests.withdrawJoin).toHaveBeenCalledWith(
        expect.objectContaining({ cause: "invite-accepted" }),
      );
    });
  });

  describe("when there is no open request", () => {
    /** @scenario A pending request never blocks an invitation */
    it("does nothing at all, in either direction", async () => {
      const { service, requests } = harness({ pending: null });

      await service.resolveByInvitation({
        userId: "user_sam",
        organizationId: "org_acme",
        inviteId: "inv_1",
      });
      await service.withdrawOnInvitationAccepted({
        userId: "user_sam",
        organizationId: "org_acme",
      });

      expect(requests.approveJoin).not.toHaveBeenCalled();
      expect(requests.withdrawJoin).not.toHaveBeenCalled();
    });
  });
});

describe("given the lookup answering for a verified address", () => {
  describe("when the log line is written", () => {
    /** @scenario The lookup is rate limited and logged without the person in it */
    it("takes a limiter slot keyed to the caller", async () => {
      const { service } = harness();

      await service.lookup({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });

      expect(rateLimitMock).toHaveBeenCalledWith(
        expect.objectContaining({ key: "joinRequests.lookup:user_sam" }),
      );
    });
  });
});
