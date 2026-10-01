import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type {
  OrganizationDirectory,
  OrganizationJoinRequests,
} from "../../app/organization.members.ts";
import { OrganizationJoinDoorService } from "../organization-join-door.service.ts";

/** Spec: specs/identity/join-requests.feature, specs/identity/domain-auto-join.feature */

const directory: OrganizationDirectory = {
  findVerifiedEmail: vi.fn(async () => "sam@acme.com"),
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
    });
  });
});
