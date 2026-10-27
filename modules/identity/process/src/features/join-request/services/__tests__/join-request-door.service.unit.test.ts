import type {
  JoinRequestAggregateState,
  JoinRequestsApi,
  VerifiedEmailsResolution,
} from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserFullProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { JoinAdmissionsService } from "../join-admissions.service.ts";
import { JoinRequestDoorService } from "../join-request-door.service.ts";

/** Spec: specs/identity/join-requests.feature, specs/identity/domain-auto-join.feature */

const SAM_PROVED_ACME: VerifiedEmailsResolution = {
  kind: "resolved",
  emails: [{ identifierId: "ident_sam", value: "sam@acme.com", provider: "email" }],
};

function aRequest(overrides: Partial<JoinRequestAggregateState>): JoinRequestAggregateState {
  return {
    joinRequestId: "jreq_1",
    userId: "user_sam",
    organizationId: "org_acme",
    domain: "acme.com",
    state: "PENDING",
    matchedVia: "verified-identifier-domain",
    origin: "web",
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    expiresAtMs: null,
    resolvedAtMs: null,
    resolvedByType: null,
    resolvedById: null,
    withdrawalCause: null,
    connectionId: null,
    ...overrides,
  };
}

function aProfile(
  person: Pick<UserFullProfile, "id" | "name" | "email" | "emailVerified">,
): UserFullProfile {
  const at = new Date(1_700_000_000_000);
  return {
    ...person,
    image: null,
    pendingSsoSetup: false,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
}

function aDoor({
  joinRequests,
  verified = SAM_PROVED_ACME,
  profiles = [{ id: "user_sam", name: "Sam", email: "sam@acme.com", emailVerified: true }],
}: {
  joinRequests: Partial<JoinRequestsApi>;
  verified?: VerifiedEmailsResolution;
  profiles?: Pick<UserFullProfile, "id" | "name" | "email" | "emailVerified">[];
}) {
  const getProfiles: UserApi["getProfiles"] = async ({ userIds }) =>
    profiles.filter(({ id }) => userIds.includes(id)).map(aProfile);
  return JoinRequestDoorService.create({
    joinRequests: createApiFixture<JoinRequestsApi>(joinRequests),
    admissions: JoinAdmissionsService.create({ findApprovedForOrganization: async () => [] }),
    emails: { verifiedEmailsOf: async () => verified },
    users: createApiFixture<UserApi>({ getProfiles }),
  });
}

describe("given the join door serving somebody already signed in", () => {
  describe("when they wave the offer away", () => {
    /** @scenario Saying no thanks is remembered for that domain and no other */
    it("dismisses it against their own verified address", async () => {
      const dismissOffer = vi.fn(async () => undefined);
      const door = aDoor({ joinRequests: { dismissOffer } });

      await door.dismissOffer({ userId: "user_sam" });

      expect(dismissOffer).toHaveBeenCalledWith({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });
    });
  });

  describe("when they are not on identifiers yet", () => {
    /** @scenario Saying no thanks is remembered for that domain and no other */
    it("falls back to the legacy address only where it was verified", async () => {
      const dismissOffer = vi.fn(async (_input: { verifiedEmail: string | null }) => undefined);
      const legacy = { kind: "keep_legacy" } as const;
      const verifiedDoor = aDoor({ joinRequests: { dismissOffer }, verified: legacy });
      const unverifiedDoor = aDoor({
        joinRequests: { dismissOffer },
        verified: legacy,
        profiles: [{ id: "user_sam", name: "Sam", email: "sam@acme.com", emailVerified: false }],
      });

      await verifiedDoor.dismissOffer({ userId: "user_sam" });
      await unverifiedDoor.dismissOffer({ userId: "user_sam" });

      expect(dismissOffer.mock.calls.map(([call]) => call.verifiedEmail)).toEqual([
        "sam@acme.com",
        null,
      ]);
    });
  });
});

describe("given the members area asking who walked in", () => {
  describe("when the ledger has an automatic join", () => {
    /** @scenario The admins are told after the fact, straight away */
    it("names the person and dates the join from its resolution", async () => {
      const door = aDoor({
        joinRequests: {
          automaticJoinsForOrganization: async () => [
            aRequest({ state: "APPROVED", resolvedAtMs: 1_700_000_000_000 }),
          ],
        },
      });

      const joins = await door.listAutomaticJoins({ organizationId: "org_acme" });

      expect(joins).toEqual([
        {
          joinRequestId: "jreq_1",
          userId: "user_sam",
          name: "Sam",
          domain: "acme.com",
          joinedAt: new Date(1_700_000_000_000),
        },
      ]);
    });
  });
});

describe("given an administrator saving the joining setting", () => {
  /** @scenario The setting change is itself audited */
  it("hands the ledger the acting administrator and returns both domain lists", async () => {
    const setJoining = vi.fn(async () => ({
      previous: "request" as const,
      next: "off" as const,
      previousDomains: [],
      nextDomains: [],
      previousJoinerRole: "MEMBER" as const,
      nextJoinerRole: "MEMBER" as const,
    }));
    const door = aDoor({ joinRequests: { setJoining } });

    const change = await door.setJoining({
      organizationId: "org_acme",
      domainJoin: "off",
      domains: [],
      actorUserId: "user_ana",
    });

    expect(setJoining).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user_ana" }));
    expect(change).toEqual({
      previous: "request",
      next: "off",
      previousDomains: [],
      nextDomains: [],
      previousJoinerRole: "MEMBER",
      nextJoinerRole: "MEMBER",
    });
  });
});

describe("given a request made from the terminal (ADR-171 v6)", () => {
  /** @scenario A request made from the terminal lands as a Developer when approved */
  it("hands the origin to the ledger", async () => {
    const request = vi.fn(async () => ({ joinRequestId: "jreq_1", state: "PENDING" as const }));
    const door = aDoor({ joinRequests: { request } });

    await door.file({ userId: "user_sam", organizationId: "org_acme", origin: "cli" });

    expect(request).toHaveBeenCalledWith({
      userId: "user_sam",
      verifiedEmail: "sam@acme.com",
      organizationId: "org_acme",
      origin: "cli",
    });
  });

  /** @scenario A request made on the web keeps the organisation's joiner seat */
  it("names no origin for an older client, which the ledger reads as web", async () => {
    const request = vi.fn(async () => ({ joinRequestId: "jreq_1", state: "PENDING" as const }));
    const door = aDoor({ joinRequests: { request } });

    await door.file({ userId: "user_sam", organizationId: "org_acme" });

    expect(request).toHaveBeenCalledWith({
      userId: "user_sam",
      verifiedEmail: "sam@acme.com",
      organizationId: "org_acme",
    });
  });

  /** @scenario The welcome screen honours an automatic door */
  it("hands the origin to the automatic door too", async () => {
    const joinAutomaticallyIfAdmitted = vi.fn(async () => ({ organization: null }));
    const door = aDoor({ joinRequests: { joinAutomaticallyIfAdmitted } });

    await door.admitAutomatically({ userId: "user_sam", origin: "cli" });

    expect(joinAutomaticallyIfAdmitted).toHaveBeenCalledWith({
      userId: "user_sam",
      verifiedEmail: "sam@acme.com",
      origin: "cli",
    });
  });
});

describe("given an administrator opening the pending list", () => {
  /** @scenario The pending list shows the seat each request will land as */
  it("shows a Developer seat for the terminal's request and the joiner seat for the web's", async () => {
    const door = aDoor({
      joinRequests: {
        pendingForOrganization: async () => [
          aRequest({ joinRequestId: "jreq_cli", origin: "cli" }),
          aRequest({ joinRequestId: "jreq_web", origin: "web" }),
        ],
        readJoining: async () => ({ domainJoin: "request", joinDomains: [], joinerRole: "MEMBER" }),
      },
    });

    const pending = await door.listPending({ organizationId: "org_acme" });

    expect(pending.map(({ joinRequestId, seat }) => ({ joinRequestId, seat }))).toEqual([
      { joinRequestId: "jreq_cli", seat: "DEVELOPER" },
      { joinRequestId: "jreq_web", seat: "MEMBER" },
    ]);
  });
});
