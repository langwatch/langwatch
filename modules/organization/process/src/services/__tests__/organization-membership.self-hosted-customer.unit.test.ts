/** Spec: specs/self-hosting/connected-services/license-registry.feature */
import { generate } from "@langwatch/ksuid";
import { ORGANIZATION_KSUID_RESOURCE } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
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

/** A customer created as licensing's fact asks: under an id licensing minted. */
async function customerOf({
  service,
  name,
}: {
  service: ReturnType<typeof installed>["service"];
  name: string;
}): Promise<{ id: string }> {
  const id = generate(ORGANIZATION_KSUID_RESOURCE).toString();
  await service.createSelfHostedCustomer({ organizationId: id, name });
  return { id };
}

describe("OrganizationMembershipService.createSelfHostedCustomer", () => {
  describe("when a licence is issued to a customer with no organization yet", () => {
    /** @scenario "Every way an organization is created records lw.organization.created" */
    it("creates the organization with its first team, exactly as provisioning does", async () => {
      const { service, organizations, seeded } = installed();

      const customer = await customerOf({ service, name: "Acme Corp" });

      await expect(service.getProvisioningSummary(customer.id)).resolves.toMatchObject({
        name: "Acme Corp",
      });
      // What `ProjectApi.ensureInternal` reads: an organization with no team
      // would refuse there, long after the licence was issued.
      await expect(organizations.getOldestTeamId(customer.id)).resolves.toEqual(expect.any(String));
      expect(seeded).toEqual([customer.id]);
    });

    /** @scenario "A customer organization gets the same kind of id as any other organization" */
    it("creates the organization under the organization_ id licensing minted", async () => {
      const { service } = installed();

      const customer = await customerOf({ service, name: "ACME" });

      expect(customer.id).toMatch(/^organization_/);
      await expect(service.getProvisioningSummary(customer.id)).resolves.toMatchObject({
        id: customer.id,
      });
    });

    it("marks the organization as a self-hosted customer", async () => {
      const { service, memory } = installed();

      const customer = await customerOf({ service, name: "Acme Corp" });

      expect(memory.selfHostedCustomers.has(customer.id)).toBe(true);
    });
  });

  describe("when licensing's fact is delivered twice", () => {
    it("creates the organization once and leaves it marked", async () => {
      const { service, memory, seeded } = installed();
      const organizationId = generate(ORGANIZATION_KSUID_RESOURCE).toString();

      await service.createSelfHostedCustomer({ organizationId, name: "Acme Corp" });
      await service.createSelfHostedCustomer({ organizationId, name: "Acme Corp" });

      expect(seeded).toEqual([organizationId]);
      expect([...memory.selfHostedCustomers]).toEqual([organizationId]);
    });
  });

  describe("when an existing organization becomes a customer", () => {
    it("marks it, and marking twice changes nothing", async () => {
      const { service, memory } = installed();
      const { organization } = await service.createForProvisioning({ name: "Globex" });

      await service.markSelfHostedCustomer({ organizationId: organization.id });
      await service.markSelfHostedCustomer({ organizationId: organization.id });

      expect([...memory.selfHostedCustomers]).toEqual([organization.id]);
    });

    it("refuses an organization that does not exist", async () => {
      const { service } = installed();

      await expect(
        service.markSelfHostedCustomer({ organizationId: "org_missing" }),
      ).rejects.toThrow(/org_missing/);
    });
  });
});

describe("OrganizationMembershipService.findSelfHostedCustomers", () => {
  describe("when some organizations are customers and some are not", () => {
    it("names only the customers, each with its organization name", async () => {
      const { service } = installed();
      const acme = await customerOf({ service, name: "Acme Corp" });
      await service.createForProvisioning({ name: "Not a customer" });

      await expect(service.findSelfHostedCustomers()).resolves.toEqual([
        { organizationId: acme.id, organizationName: "Acme Corp" },
      ]);
    });
  });

  describe("when no organization is a customer", () => {
    it("answers an empty list", async () => {
      const { service } = installed();

      await expect(service.findSelfHostedCustomers()).resolves.toEqual([]);
    });
  });
});

describe("OrganizationMembershipService.findRepresentatives", () => {
  describe("when the organization has members", () => {
    it("names its longest-standing member, the same one every time", async () => {
      const { service, memory } = installed();
      const acme = await customerOf({ service, name: "Acme Corp" });
      const joined = (userId: string, at: string) => ({
        userId,
        organizationId: acme.id,
        role: "MEMBER" as const,
        disabledAt: null,
        createdAt: Temporal.Instant.from(at),
        updatedAt: Temporal.Instant.from(at),
      });
      memory.organizationUsers.push(
        joined("user-late", "2026-03-01T00:00:00Z"),
        joined("user-first", "2026-01-01T00:00:00Z"),
      );

      await expect(service.findRepresentatives({ organizationId: acme.id })).resolves.toEqual([
        { userId: "user-first", organizationName: "Acme Corp" },
      ]);
    });
  });

  describe("when the organization has no member", () => {
    it("answers an empty list", async () => {
      const { service } = installed();
      const acme = await customerOf({ service, name: "Acme Corp" });

      await expect(service.findRepresentatives({ organizationId: acme.id })).resolves.toEqual([]);
    });
  });
});
