import { OrganizationUserRole } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import type {
  OrganizationGrantCache,
  OrganizationSeatRevocationNotice,
} from "../organization-member-role.service.ts";
import { OrganizationMembershipService } from "../organization-membership.service.ts";
import type { OrganizationCreationNotice } from "../organization-provisioning.service.ts";
import type { OrganizationSeatLicense } from "../organization-seat-license.service.ts";

const ORGANIZATION = "org_acme";

let memory: MemoryOrganizationDatabase;
let service: OrganizationMembershipService;
let recorded: unknown[];

function seedMember(userId: string, role: OrganizationUserRole): void {
  const now = Temporal.Instant.fromEpochMilliseconds(0);
  memory.organizationUsers.push({
    userId,
    organizationId: ORGANIZATION,
    role,
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(() => {
  memory = MemoryOrganizationDatabase.create();
  recorded = [];
  service = OrganizationMembershipService.create({
    workspaceNotices: { personalWorkspaceArchived: () => Promise.resolve() },
    memberNotices: {
      memberRemoved: async (input) => {
        recorded.push({ removed: input });
      },
      memberDepartmentChanged: async (input) => {
        recorded.push({ department: input });
      },
    },
    repository: MemoryOrganizationMembershipRepository.create({ memory }),
    creations: createApiFixture<OrganizationCreationNotice>(),
    seats: createApiFixture<OrganizationSeatLicense>(),
    seatNotices: createApiFixture<OrganizationSeatRevocationNotice>(),
    grantCache: createApiFixture<OrganizationGrantCache>(),
    testArrivals: { standingFor: async () => ({ testing: false }) as const },
    ceiling: { assertWithinCaller: async () => {} },
    admissions: {
      attachBindings: () => Promise.reject(new Error("no admission expected")),
      completeAdmission: () => Promise.reject(new Error("no admission expected")),
    },
  });
});

describe("given a member of the organization", () => {
  describe("when an administrator removes them", () => {
    it("records the removal, so governance revokes what the membership gave", async () => {
      seedMember("user_ana", OrganizationUserRole.ADMIN);
      seedMember("user_ben", OrganizationUserRole.MEMBER);

      await service.deleteMember({
        organizationId: ORGANIZATION,
        userId: "user_ben",
        actingUserId: "user_ana",
      });

      expect(recorded).toEqual([
        {
          removed: {
            organizationId: ORGANIZATION,
            userId: "user_ben",
            removedByUserId: "user_ana",
          },
        },
      ]);
    });
  });

  describe("when their department is set", () => {
    it("records the change, so governance re-reads its aggregates", async () => {
      seedMember("user_ben", OrganizationUserRole.MEMBER);
      const input = { organizationId: ORGANIZATION, userId: "user_ben", departmentId: "dept_1" };

      await expect(service.assignMemberDepartment(input)).resolves.toBe(true);

      expect(recorded).toEqual([{ department: input }]);
    });
  });

  describe("when the department write finds no member", () => {
    it("records nothing", async () => {
      await expect(
        service.assignMemberDepartment({
          organizationId: ORGANIZATION,
          userId: "user_nobody",
          departmentId: "dept_1",
        }),
      ).resolves.toBe(false);

      expect(recorded).toEqual([]);
    });
  });

  describe("when a provisioned organization is deleted", () => {
    it("records every member it took as removed, by no member", async () => {
      seedMember("user_ann", OrganizationUserRole.ADMIN);
      seedMember("user_ben", OrganizationUserRole.MEMBER);

      await service.deleteProvisionedOrganization({ organizationId: ORGANIZATION });

      expect(recorded).toEqual([
        { removed: { organizationId: ORGANIZATION, userId: "user_ann", removedByUserId: null } },
        { removed: { organizationId: ORGANIZATION, userId: "user_ben", removedByUserId: null } },
      ]);
    });
  });
});
