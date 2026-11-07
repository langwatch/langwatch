// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A person a directory provisions again within their 30-day seat hold takes the held seat back.
 * @see specs/licensing/seat-rotation.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { HeldConnectionsFake } from "../../__tests__/support/held-connections-fake.ts";
import {
  MembersFake,
  OrganizationAdministrationFake,
} from "../../__tests__/support/organization-administration-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import type { ScimSeats } from "../scim-seat-lease.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const ORGANIZATION_ID = "org-1";

const person: UserProfile = {
  id: "user-1",
  name: "Alice Smith",
  email: "alice@acme.com",
  emailVerified: false,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-02T00:00:00Z"),
  lastLoginAt: null,
  deactivatedAt: null,
};

/** One full seat on the plan, and it is in use: by Alice's hold, or by somebody else. */
class OneSeatPlan implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 1,
      maxMembersLite: 0,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function seatsWith({ heldBy }: { heldBy: string[] }): ScimSeats {
  return {
    countMemberSeats: async () => ({ fullMembers: 1, liteMembers: 0, developers: 0 }),
    findLiveHoldUserIds: async () => heldBy,
    withSeatLock: ({ work }) => work({ assertHeld: async () => {} }),
  };
}

function provision({
  seats,
  members = new MembersFake(),
}: {
  seats: ScimSeats;
  members?: MembersFake;
}) {
  const repository = scimRepositoryFixture();
  const users = {
    findByEmail: vi.fn(async () => null),
    findById: vi.fn(async () => person),
    create: vi.fn(async () => person),
  } satisfies ScimUserProvisioning;
  const service = ScimService.create({
    members,
    connections: HeldConnectionsFake.of(),
    prisma: repository,
    writer: new GrantsFake(),
    users,
    costCenterFacts: { recordCostCenterChanged: vi.fn(async () => undefined) },
    organization: new OrganizationAdministrationFake(),
    entitlements: new OneSeatPlan(),
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding: false,
    tokenPepper: "scim-test-pepper",
    seats,
  });
  const push = () =>
    service.createUser({
      organizationId: ORGANIZATION_ID,
      request: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "alice@acme.com",
      },
    });
  return { repository, members, push };
}

describe("a directory provisioning a person whose seat is held", () => {
  describe("given the only full seat is held by the person the directory provisions again", () => {
    /** @scenario "A person provisioned again by the directory within their hold takes the held seat" */
    it("admits them on the held seat and has organization take it back", async () => {
      const { repository, members, push } = provision({ seats: seatsWith({ heldBy: ["user-1"] }) });

      await push();

      expect(repository.addMembership).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: ORGANIZATION_ID,
        role: "MEMBER",
        pending: false,
      });
      expect(members.takeBackHeldSeat).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        userId: "user-1",
      });
    });
  });

  describe("given the only full seat is held by somebody else", () => {
    /** @scenario "A seat held for someone else is not given to a newcomer" */
    it("leaves the newcomer waiting and takes no held seat back", async () => {
      const { repository, members, push } = provision({ seats: seatsWith({ heldBy: [] }) });

      await push();

      expect(repository.addMembership).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1", pending: true }),
      );
      expect(members.takeBackHeldSeat).not.toHaveBeenCalled();
    });

    /** @scenario "A person the directory pushes while every seat is taken opens a seat request" */
    it("asks organization to open the seat request of the person left waiting", async () => {
      const { members, push } = provision({ seats: seatsWith({ heldBy: [] }) });

      await push();

      expect(members.openSeatRequestForAdmission).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        userId: "user-1",
        admission: { outcome: "created", seat: "EXTERNAL", pending: true },
      });
    });

    it("still admits the person when the seat request cannot be opened", async () => {
      const members = new MembersFake();
      members.openSeatRequestForAdmission.mockRejectedValueOnce(new Error("database unavailable"));
      const { repository, push } = provision({ seats: seatsWith({ heldBy: [] }), members });

      await expect(push()).resolves.toBeDefined();
      expect(repository.addMembership).toHaveBeenCalled();
    });
  });

  describe("given organization cannot take the held seat back", () => {
    it("fails the push so the directory's retry repairs it", async () => {
      const members = new MembersFake();
      members.takeBackHeldSeat.mockRejectedValueOnce(new Error("database unavailable"));
      const { push } = provision({ seats: seatsWith({ heldBy: ["user-1"] }), members });

      await expect(push()).rejects.toThrow("database unavailable");
    });
  });
});
