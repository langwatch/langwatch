/** Spec: modules/ops/specs/checkup-canary-project.feature */
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../../repositories/memory/memory.organization.repository.ts";
import type {
  OrganizationGrantCache,
  OrganizationSeatRevocationNotice,
} from "../organization-member-role.service.ts";
import { OrganizationMembershipService } from "../organization-membership.service.ts";
import type { OrganizationCreationNotice } from "../organization-provisioning.service.ts";
import type { OrganizationSeatLicense } from "../organization-seat-license.service.ts";

const refuse = (what: string) => () => Promise.reject(new Error(`${what} is not asked here`));

function installed() {
  const memory = MemoryOrganizationDatabase.create();
  const seeded: string[] = [];
  const creations: OrganizationCreationNotice = {
    created: async ({ organizationId }) => {
      seeded.push(organizationId);
    },
    reportError: () => undefined,
  };
  const seats: OrganizationSeatLicense = {
    checkLimit: refuse("a seat limit"),
    assertRoleChangeAllowed: refuse("a role change"),
  };
  const seatNotices: OrganizationSeatRevocationNotice = {
    memberDisabled: refuse("a seat revocation record"),
    memberEnabled: refuse("a seat restoration record"),
  };
  const grantCache: OrganizationGrantCache = { invalidateOrganization: refuse("a grant cache") };
  const service = OrganizationMembershipService.create({
    workspaceNotices: { personalWorkspaceArchived: () => Promise.resolve() },
    memberNotices: { memberRemoved: async () => {}, memberDepartmentChanged: async () => {} },
    repository: MemoryOrganizationMembershipRepository.create({ memory }),
    creations,
    seats,
    seatNotices,
    grantCache,
    testArrivals: { standingFor: async () => ({ testing: false }) },
    ceiling: { assertWithinCaller: async () => {} },
    admissions: {
      attachBindings: () => Promise.reject(new Error("no admission expected")),
      completeAdmission: () => Promise.reject(new Error("no admission expected")),
    },
  });
  return {
    memory,
    seeded,
    service,
    organizations: MemoryOrganizationRepository.create({ memory }),
  };
}

describe("OrganizationMembershipService.ensureSystemOrganization", () => {
  describe("when the hidden system organization is ensured", () => {
    /** @scenario "The hidden organisation and project are never listed where a person looks" */
    it("is created once, recorded with no creation notice and listed nowhere", async () => {
      const { service, organizations, seeded } = installed();
      const customer = await service.createForProvisioning({ name: "Acme Corp" });

      const first = await service.ensureSystemOrganization();
      const second = await service.ensureSystemOrganization();

      expect(second.id).toBe(first.id);
      expect(seeded).toEqual([customer.organization.id]);
      expect((await organizations.listAllIds()).ids).toEqual([customer.organization.id]);
      expect((await service.listProvisioningSummaries()).map(({ id }) => id)).toEqual([
        customer.organization.id,
      ]);
    });

    it("holds one team the hidden project hangs from", async () => {
      const { service, organizations } = installed();

      const { id } = await service.ensureSystemOrganization();

      await expect(organizations.getOldestTeamId(id)).resolves.toEqual(expect.any(String));
    });
  });
});
