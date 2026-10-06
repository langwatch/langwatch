import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationDirectory } from "../organization-directory.service.ts";
import { OrganizationJoinDoorService } from "../organization-join-door.service.ts";
import type { OrganizationJoinRequests } from "../organization-join-requests.service.ts";

/** Spec: specs/identity/join-requests.feature, specs/identity/domain-auto-join.feature */

const directory: OrganizationDirectory = {
  findVerifiedEmail: vi.fn(async () => "sam@acme.com"),
  findProvenAddresses: vi.fn(async () => ["sam@acme.com"]),
  listUserNames: vi.fn(async () => [{ id: "user_sam", name: "Sam" }]),
};

describe("given the join door serving somebody already signed in", () => {
  describe("when they wave the offer away", () => {
    /** @scenario Saying no thanks is remembered for that domain and no other */
    it("dismisses it against their own verified address", async () => {
      const dismissOffer = vi.fn(async () => undefined);
      const door = OrganizationJoinDoorService.create({
        joinRequests: createApiFixture<OrganizationJoinRequests>({ dismissOffer }),
        directory,
      });

      await door.dismissOffer({ userId: "user_sam" });

      expect(dismissOffer).toHaveBeenCalledWith({
        userId: "user_sam",
        verifiedEmail: "sam@acme.com",
      });
    });
  });
});

describe("given the members area asking who walked in", () => {
  describe("when the ledger has an automatic join", () => {
    /** @scenario The admins are told after the fact, straight away */
    it("names the person and dates the join from its resolution", async () => {
      const door = OrganizationJoinDoorService.create({
        joinRequests: createApiFixture<OrganizationJoinRequests>({
          automaticJoinsForOrganization: async () => [
            {
              joinRequestId: "jreq_1",
              userId: "user_sam",
              organizationId: "org_acme",
              domain: "acme.com",
              origin: "web" as const,
              createdAtMs: 1_700_000_000_000,
              expiresAtMs: null,
              resolvedAtMs: 1_700_000_000_000,
            },
          ],
        }),
        directory,
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
    const door = OrganizationJoinDoorService.create({
      joinRequests: createApiFixture<OrganizationJoinRequests>({ setJoining }),
      directory,
    });

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
    const door = OrganizationJoinDoorService.create({
      joinRequests: createApiFixture<OrganizationJoinRequests>({ request }),
      directory,
    });

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
    const door = OrganizationJoinDoorService.create({
      joinRequests: createApiFixture<OrganizationJoinRequests>({ request }),
      directory,
    });

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
    const door = OrganizationJoinDoorService.create({
      joinRequests: createApiFixture<OrganizationJoinRequests>({ joinAutomaticallyIfAdmitted }),
      directory,
    });

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
    const waiting = (joinRequestId: string, origin: "web" | "cli") => ({
      joinRequestId,
      userId: "user_sam",
      organizationId: "org_acme",
      domain: "acme.com",
      origin,
      createdAtMs: 1_700_000_000_000,
      expiresAtMs: null,
      resolvedAtMs: null,
    });
    const door = OrganizationJoinDoorService.create({
      joinRequests: createApiFixture<OrganizationJoinRequests>({
        pendingForOrganization: async () => [
          waiting("jreq_cli", "cli"),
          waiting("jreq_web", "web"),
        ],
        readJoining: async () => ({ domainJoin: "request", joinDomains: [], joinerRole: "MEMBER" }),
      }),
      directory,
    });

    const pending = await door.listPending({ organizationId: "org_acme" });

    expect(pending.map(({ joinRequestId, seat }) => ({ joinRequestId, seat }))).toEqual([
      { joinRequestId: "jreq_cli", seat: "DEVELOPER" },
      { joinRequestId: "jreq_web", seat: "MEMBER" },
    ]);
  });
});
