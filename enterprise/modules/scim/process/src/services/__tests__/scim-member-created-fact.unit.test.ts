// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A directory create records one member-created fact naming the member; the seat is organization's.
 * @see modules/organization/specs/seat-peak.feature
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
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

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

/** A licence of ten full and ten Lite Member seats. */
class TenSeatPlan implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 10,
      maxMembersLite: 10,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

/** A directory with a full seat free, so the create is admitted rather than held. */
function directoryOver() {
  const repository = MemoryScimRepository.create();
  repository.users.set(person.id, person);
  let created = false;
  const users = {
    findByEmail: vi.fn(async () => (created ? person : null)),
    findById: vi.fn(async () => person),
    create: vi.fn(async () => {
      created = true;
      return person;
    }),
  } satisfies ScimUserProvisioning;
  const service = ScimService.create({
    members: new MembersFake(),
    connections: HeldConnectionsFake.of(),
    prisma: repository,
    writer: new GrantsFake(),
    users,
    costCenterFacts: { recordCostCenterChanged: vi.fn(async () => undefined) },
    organization: new OrganizationAdministrationFake(),
    entitlements: new TenSeatPlan(),
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding: false,
    tokenPepper: "scim-test-pepper",
    seats: {
      countMemberSeats: async () => ({ fullMembers: 9, liteMembers: 0, developers: 0 }),
      findLiveHoldUserIds: async () => [],
      withSeatLock: ({ work }) => work({ assertHeld: async () => {} }),
    },
  });
  const push = () =>
    service.createUser({
      organizationId: "org-1",
      request: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "alice@acme.com",
      },
    });
  return { repository, push };
}

describe("the member-created fact a directory create records", () => {
  describe("given a full seat free", () => {
    /** @scenario "A seat taken on any path is counted" */
    it("records one fact naming the member and the organization", async () => {
      const { repository, push } = directoryOver();

      await push();

      expect(repository.memberCreatedFacts).toEqual([
        expect.objectContaining({
          tenantId: "org-1",
          organizationId: "org-1",
          userId: "user-1",
        }),
      ]);
    });

    it("records no second fact when the directory retries the create", async () => {
      const { repository, push } = directoryOver();

      await push();
      await push().catch(() => undefined);

      expect(repository.memberCreatedFacts).toHaveLength(1);
    });
  });
});
