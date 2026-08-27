import type {
  DomainJoinSetting,
  JoinCandidateOrganization,
  JoinRequestAggregateState,
} from "@langwatch/identity";
import {
  DEFAULT_DOMAIN_JOIN_SETTING,
  emptyJoinRequest,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true, remaining: 5, resetAt: Date.now() })),
);
vi.mock("~/server/rateLimit", () => ({ rateLimit: rateLimitMock }));

import {
  JOIN_REJECTION_COOLDOWN_MS,
  type JoinMembershipPort,
  type JoinOfferDismissalPort,
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
  domainProved: false,
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
  policyEntitled = true,
  isMember = false,
  memberOf,
  dismissedDomains = [],
  setting = { domainJoin: "request" as DomainJoinSetting, joinDomains: [] },
}: {
  candidates?: JoinCandidateOrganization[];
  held?: JoinRequestAggregateState | null;
  pending?: JoinRequestAggregateState | null;
  lastRejectionAt?: Date | null;
  licensed?: boolean;
  /** Whether this organization's PLAN carries the who-can-join control. */
  policyEntitled?: boolean;
  isMember?: boolean;
  /** Membership per organization, for the cases where "already in one" and
   *  "not in the other" is the whole point. Overrides `isMember`. */
  memberOf?: string[];
  dismissedDomains?: string[];
  setting?: { domainJoin: DomainJoinSetting; joinDomains: string[] };
} = {}) {
  const requests = {
    requestJoin: vi.fn(async (_command: Record<string, unknown>) => []),
    approveJoin: vi.fn(async (_command: Record<string, unknown>) => []),
    // The command is declared so `mock.calls` carries its type: the
    // assertion below is that a field is ABSENT from it, and an untyped
    // mock makes that a cast rather than a check.
    rejectJoin: vi.fn(async (_command: Record<string, unknown>) => []),
    withdrawJoin: vi.fn(async () => []),
    expireJoin: vi.fn(async () => []),
  };
  const membership: JoinMembershipPort = {
    attachDefaultMembership: vi.fn(async () => undefined),
    isMember: vi.fn(async ({ organizationId }) =>
      memberOf ? memberOf.includes(organizationId) : isMember,
    ),
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
    findAutomaticJoinsForOrganization: vi.fn(async () => []),
  };
  const dismissals: JoinOfferDismissalPort = {
    dismissedDomains: vi.fn(async () => dismissedDomains),
    dismiss: vi.fn(async () => undefined),
  };
  const autoJoinLicensed = vi.fn(async () => licensed);
  const joinPolicyEntitled = vi.fn(async () => policyEntitled);

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
    dismissals,
    autoJoinLicensed,
    joinPolicyEntitled,
    now: () => NOW,
  });

  return {
    service,
    requests,
    membership,
    notifier,
    settings,
    reads,
    dismissals,
    autoJoinLicensed,
    joinPolicyEntitled,
  };
}

beforeEach(() => {
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({
    allowed: true,
    remaining: 5,
    resetAt: NOW + 60_000,
  });
});

describe("given somebody who already belongs to one of the matches", () => {
  const acmeLabs: JoinCandidateOrganization = {
    ...acme,
    organizationId: "org_acme_labs",
    name: "Acme Labs",
  };

  describe("when the organizations open to their address are looked up", () => {
    /** @scenario An organization I am already in is not offered, and the others still are */
    it("offers the one they are not in and never the one they are", async () => {
      const { service } = harness({
        candidates: [acme, acmeLabs],
        memberOf: ["org_acme"],
      });

      const decision = await service.lookup({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });

      // Belonging somewhere is not a reason to be told nothing: the second
      // organization is a real thing to ask for, and the offer is the only
      // way they would learn it exists.
      expect(decision.outcome).toBe("ask");
      const offered =
        decision.outcome === "ask"
          ? decision.organizations.map((entry) => entry.organizationId)
          : [];
      expect(offered).toEqual(["org_acme_labs"]);
    });

    /** @scenario An organization I am already in is not offered, and the others still are */
    it("answers the universal nothing when the only match is one they are in", async () => {
      const { service } = harness({
        candidates: [acme],
        memberOf: ["org_acme"],
      });

      const decision = await service.lookup({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });

      // The same nothing every other closed door gives. An "ask to join"
      // beside the workspace somebody is already using reads as the product
      // not knowing who they are, and asking could only ever be refused.
      expect(decision).toEqual({ outcome: "none" });
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

      // Pinned before the absence check below: `not.toHaveProperty` on an
      // `undefined` command passes for the wrong reason, so the test would
      // stay green if the rejection stopped stating anything at all.
      expect(requests.rejectJoin).toHaveBeenCalledTimes(1);
      const [command] = requests.rejectJoin.mock.calls[0] ?? [];
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
            domainProved: true,
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
            domainProved: true,
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

describe("given an organization whose plan does not carry the joining control", () => {
  describe("when the administrator opens the door to people who ask", () => {
    /** @scenario Opening the door needs the plan that carries it */
    /** @scenario The refusal holds at the boundary, not only on the screen */
    it("refuses with the plan's own code and writes nothing", async () => {
      const { service, settings } = harness({
        policyEntitled: false,
        setting: { domainJoin: "off", joinDomains: [] },
      });

      await expect(
        service.setJoining({
          organizationId: "org_acme",
          domainJoin: "request",
          domains: [],
        }),
      ).rejects.toMatchObject({ code: "join_policy_not_licensed" });
      expect(settings.write).not.toHaveBeenCalled();
    });
  });

  describe("when the administrator opens the door to a whole domain", () => {
    /** @scenario Opening the door needs the plan that carries it */
    it("refuses on the plan before it ever asks about the domain", async () => {
      const { service, autoJoinLicensed } = harness({
        policyEntitled: false,
        setting: { domainJoin: "off", joinDomains: [] },
      });

      await expect(
        service.setJoining({
          organizationId: "org_acme",
          domainJoin: "auto",
          domains: ["acme.com"],
        }),
      ).rejects.toMatchObject({ code: "join_policy_not_licensed" });
      // The plan is the cheapest thing to fix and the first thing checked, so
      // the deployment licence is never consulted for an organization that
      // cannot hold the control anyway.
      expect(autoJoinLicensed).not.toHaveBeenCalled();
    });
  });

  describe("when the administrator closes a door that is already open", () => {
    /** @scenario Closing the door is never refused for the plan */
    it("saves, so a lapsed plan is never a door that cannot be shut", async () => {
      const { service, settings, joinPolicyEntitled } = harness({
        policyEntitled: false,
        setting: { domainJoin: "auto", joinDomains: ["acme.com"] },
      });

      await service.setJoining({
        organizationId: "org_acme",
        domainJoin: "off",
        domains: [],
      });

      expect(settings.write).toHaveBeenCalledWith({
        organizationId: "org_acme",
        domainJoin: "off",
        joinDomains: [],
      });
      expect(joinPolicyEntitled).not.toHaveBeenCalled();
    });
  });

  describe("when the administrator saves the setting they already had", () => {
    /** @scenario Closing the door is never refused for the plan */
    it("is not refused, because nothing was opened", async () => {
      const { service, settings } = harness({
        policyEntitled: false,
        candidates: [{ ...acme, domainProved: true }],
        setting: { domainJoin: "auto", joinDomains: ["acme.com"] },
      });

      await service.setJoining({
        organizationId: "org_acme",
        domainJoin: "auto",
        domains: ["acme.com"],
      });

      expect(settings.write).toHaveBeenCalled();
    });
  });

  describe("when the administrator adds a domain to a door already open", () => {
    /** @scenario Opening the door needs the plan that carries it */
    it("refuses, because another domain is more people let in", async () => {
      const { service, settings } = harness({
        policyEntitled: false,
        setting: { domainJoin: "auto", joinDomains: ["acme.com"] },
      });

      await expect(
        service.setJoining({
          organizationId: "org_acme",
          domainJoin: "auto",
          domains: ["acme.com", "acme.co.uk"],
        }),
      ).rejects.toMatchObject({ code: "join_policy_not_licensed" });
      expect(settings.write).not.toHaveBeenCalled();
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

  describe("when the domain has not been proved", () => {
    /** @scenario Turning it on names the domain and needs the domain proved */
    it("refuses however many members hold addresses on it", async () => {
      // Four verified members and still no: receiving mail on a domain is
      // not controlling it, and nobody gates the automatic path.
      const { service } = harness({
        candidates: [
          { ...acme, verifiedMembersOnDomain: 4, domainProved: false },
        ],
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
      // Proved is what lets the door open: the record or file ceremony, an
      // attestation, or a licence — never a count of members.
      const { service, settings } = harness({
        candidates: [{ ...acme, domainProved: true }],
      });

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
      // Both values and both domain lists, because the audit row the caller
      // writes has to say what it was as well as what it became.
      expect(result).toEqual({
        previous: "request",
        next: "auto",
        previousDomains: [],
        nextDomains: ["acme.com"],
      });
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

describe("given an organization that admits its domain automatically", () => {
  const admitting: JoinCandidateOrganization = {
    ...acme,
    domainJoin: "auto",
    autoJoinDomains: ["acme.com"],
    domainProved: true,
  };

  describe("when a verified colleague walks in", () => {
    /** @scenario The automatic path is the same lifecycle, approved by policy */
    it("makes a request and resolves it against the same aggregate", async () => {
      const { service, requests } = harness({ candidates: [admitting] });

      await service.joinAutomaticallyIfAdmitted({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });

      const [requested] = requests.requestJoin.mock.calls[0]!;
      const [approved] = requests.approveJoin.mock.calls[0]!;
      // The SAME request, on the same aggregate and the same tenant, which is
      // what puts it in the same panel and the same history as an approval
      // somebody clicked. Only the resolver differs.
      expect(approved.joinRequestId).toBe(requested.joinRequestId);
      expect(approved.tenantId).toBe(requested.tenantId);
      expect(approved.organizationId).toBe("org_acme");
      expect(approved.resolvedBy).toEqual({
        type: "policy",
        id: "domain-auto",
      });
    });

    /** @scenario The automatic path is the same lifecycle, approved by policy */
    it("records the policy rather than a person as what resolved it", async () => {
      const { service, requests, membership } = harness({
        candidates: [admitting],
      });

      await service.joinAutomaticallyIfAdmitted({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });

      const [approved] = requests.approveJoin.mock.calls[0]!;
      expect((approved.resolvedBy as { type: string }).type).not.toBe("user");
      // And nobody is named as the approver on the membership either.
      expect(membership.attachDefaultMembership).toHaveBeenCalledWith(
        expect.objectContaining({ approvedByUserId: null }),
      );
    });

    /** @scenario Walking in still grants only the default role */
    it("attaches the default membership and carries no role at all", async () => {
      const { service, membership } = harness({ candidates: [admitting] });

      await service.joinAutomaticallyIfAdmitted({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });

      // No role on the call and never will be: an approval — by an admin or
      // by the policy — grants the organization's default and nothing more.
      const attach = membership.attachDefaultMembership as unknown as {
        mock: { calls: [Record<string, unknown>][] };
      };
      const [attached] = attach.mock.calls[0]!;
      expect(Object.keys(attached).sort()).toEqual([
        "approvedByUserId",
        "organizationId",
        "userId",
      ]);
    });
  });

  describe("when the address has not been verified", () => {
    /** @scenario An unverified address never walks in */
    it("admits nobody, and verifying is what changes that", async () => {
      const { service, requests, membership } = harness({
        candidates: [admitting],
      });

      expect(
        await service.joinAutomaticallyIfAdmitted({
          userId: "user_sam",
          verifiedEmail: null,
        }),
      ).toBeNull();
      expect(requests.requestJoin).not.toHaveBeenCalled();
      expect(membership.attachDefaultMembership).not.toHaveBeenCalled();

      // The same person, the same organization, one address proved.
      const joined = await service.joinAutomaticallyIfAdmitted({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });
      expect(joined?.organization.organizationId).toBe("org_acme");
    });
  });

  describe("when a second organization claims the same domain", () => {
    /** @scenario An ambiguous domain refuses to admit and falls back to asking */
    it("admits neither and offers both as somewhere to ask", async () => {
      const { service, requests } = harness({
        candidates: [
          admitting,
          { ...admitting, organizationId: "org_other", name: "Other" },
        ],
      });

      expect(
        await service.joinAutomaticallyIfAdmitted({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
        }),
      ).toBeNull();
      expect(requests.requestJoin).not.toHaveBeenCalled();

      // Guessing which company somebody works for is the one thing this must
      // never do, so the choice goes back to them.
      const decision = await service.lookup({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });
      expect(decision.outcome).toBe("ask");
      expect(
        decision.outcome === "ask"
          ? decision.organizations.map((offer) => offer.organizationId).sort()
          : [],
      ).toEqual(["org_acme", "org_other"]);
    });
  });
});

describe("given a newly created self-serve organization", () => {
  describe("when its joining setting is read", () => {
    /** @scenario Asking is the default and automatic is never inferred */
    it("lets colleagues ask, and admits nobody automatically", async () => {
      // Exactly what the column's own default produces, and nothing an
      // administrator has touched.
      const { service } = harness({
        candidates: [
          {
            ...acme,
            domainJoin: DEFAULT_DOMAIN_JOIN_SETTING,
            autoJoinDomains: [],
            verifiedMembersOnDomain: 5,
          },
        ],
      });

      expect(
        (
          await service.lookup({
            userId: "user_sam",
            verifiedEmail: "sam@acme.com",
          })
        ).outcome,
      ).toBe("ask");
      expect(
        await service.joinAutomaticallyIfAdmitted({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
        }),
      ).toBeNull();
    });
  });
});

describe("given a deployment that has never held a genuine license", () => {
  describe("when a colleague asks to join and an administrator approves", () => {
    /** @scenario An unlicensed deployment still lets colleagues ask */
    it("opens the request, admits them, and never consults the license", async () => {
      const asking = harness({ licensed: false });

      const asked = await asking.service.request({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
        organizationId: "org_acme",
      });
      expect(asked.state).toBe("PENDING");
      expect(asking.notifier.requestArrived).toHaveBeenCalledOnce();

      const approving = harness({
        licensed: false,
        held: pendingState({ joinRequestId: asked.joinRequestId }),
      });
      await approving.service.approve({
        joinRequestId: asked.joinRequestId,
        organizationId: "org_acme",
        adminUserId: "user_ana",
      });
      expect(approving.membership.attachDefaultMembership).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_sam",
          organizationId: "org_acme",
        }),
      );

      // The gate holds AUTOMATIC joining and lets asking through, so nothing
      // on this path reads it at all.
      expect(asking.autoJoinLicensed).not.toHaveBeenCalled();
      expect(approving.autoJoinLicensed).not.toHaveBeenCalled();
    });
  });
});

describe("given somebody who asked rather than creating an organization", () => {
  describe("when the request is open", () => {
    /** @scenario No organization is created for somebody who did not ask for one */
    it("asks, and creates nothing on their behalf", async () => {
      const { service, requests, membership } = harness();

      const asked = await service.request({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
        organizationId: "org_acme",
      });

      expect(asked.state).toBe("PENDING");
      // The whole invariant: asking opens a request and nothing else. No
      // membership lands until somebody answers, and nothing on this path
      // mints an organization.
      expect(membership.attachDefaultMembership).not.toHaveBeenCalled();
      expect(requests.approveJoin).not.toHaveBeenCalled();
    });
  });

  describe("when they created a workspace while waiting and are then approved", () => {
    /** @scenario Approval reaches somebody who created a workspace while waiting */
    it("adds the second membership and tells them", async () => {
      // A member of their OWN new organization, and not of this one — which
      // is what `isMember` answers for the organization being approved.
      const { service, membership, notifier } = harness({
        held: pendingState(),
        isMember: false,
      });

      await service.approve({
        joinRequestId: "jreq_1",
        organizationId: "org_acme",
        adminUserId: "user_ana",
      });

      expect(membership.attachDefaultMembership).toHaveBeenCalledWith({
        userId: "user_sam",
        organizationId: "org_acme",
        approvedByUserId: "user_ana",
      });
      // Told, so they land in it rather than discovering it later.
      expect(notifier.requestApproved).toHaveBeenCalledWith({
        joinRequestId: "jreq_1",
        organizationId: "org_acme",
        requesterUserId: "user_sam",
      });
    });
  });
});

describe("given an existing account whose domain matches an organization", () => {
  describe("when the offer has never been waved away", () => {
    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("offers the organization", async () => {
      const { service } = harness();

      expect(
        (
          await service.offerForSignedInUser({
            userId: "user_sam",
            verifiedEmail: "sam@acme.com",
          })
        ).outcome,
      ).toBe("ask");
    });
  });

  describe("when they have dismissed it for that domain", () => {
    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("offers nothing again for that domain", async () => {
      const { service } = harness({ dismissedDomains: ["acme.com"] });

      expect(
        await service.offerForSignedInUser({
          userId: "user_sam",
          verifiedEmail: "sam@acme.com",
        }),
      ).toEqual({ outcome: "none" });
    });

    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("remembers the dismissal against that domain and no other", async () => {
      const { service, dismissals } = harness();

      await service.dismissOffer({
        userId: "user_sam",
        verifiedEmail: "Sam.J+news@Acme.com",
      });

      // Folded the way every other join decision folds an address, so a
      // dismissal and a match can never disagree about what the domain is.
      expect(dismissals.dismiss).toHaveBeenCalledWith({
        userId: "user_sam",
        domain: "acme.com",
      });
    });
  });
});
