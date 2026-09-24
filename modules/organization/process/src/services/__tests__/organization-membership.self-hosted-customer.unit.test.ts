/** Spec: specs/self-hosting/connected-services/license-registry.feature */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  OrganizationGrantCache,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSessionRevocation,
} from "../../app/organization.members.ts";
import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../../repositories/memory/memory.organization.repository.ts";
import { OrganizationMembershipService } from "../organization-membership.service.ts";

const refuse = (what: string) => () => Promise.reject(new Error(`${what} is not asked here`));

function installed() {
  const memory = MemoryOrganizationDatabase.create();
  const seeded: string[] = [];
  const prompts: OrganizationPromptSeed = {
    seedTagsForOrganization: async ({ organizationId }) => {
      seeded.push(organizationId);
    },
    reportCompensationFailure: () => undefined,
  };
  const seats: OrganizationSeatLicense = {
    checkLimit: refuse("a seat limit"),
    assertRoleChangeAllowed: refuse("a role change"),
  };
  const sessions: OrganizationSessionRevocation = {
    revokeAllBrowserSessions: refuse("a session revocation"),
  };
  const grantCache: OrganizationGrantCache = { invalidateOrganization: refuse("a grant cache") };
  const service = OrganizationMembershipService.create({
    repository: MemoryOrganizationMembershipRepository.create({ memory }),
    prompts,
    seats,
    sessions,
    grantCache,
    testArrivals: { standingFor: async () => ({ testing: false }) },
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

describe("OrganizationMembershipService.createSelfHostedCustomer", () => {
  describe("when a licence is issued to a customer with no organization yet", () => {
    it("creates the organization with its first team, exactly as provisioning does", async () => {
      const { service, organizations, seeded } = installed();

      const customer = await service.createSelfHostedCustomer({ name: "Acme Corp" });

      expect(customer.name).toBe("Acme Corp");
      // What `ProjectApi.ensureInternal` reads: an organization with no team
      // would refuse there, long after the licence was issued.
      await expect(organizations.getOldestTeamId(customer.id)).resolves.toEqual(expect.any(String));
      expect(seeded).toEqual([customer.id]);
    });

    it("marks the organization as a self-hosted customer", async () => {
      const { service, memory } = installed();

      const customer = await service.createSelfHostedCustomer({ name: "Acme Corp" });

      expect(memory.selfHostedCustomers.has(customer.id)).toBe(true);
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
      const acme = await service.createSelfHostedCustomer({ name: "Acme Corp" });
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
      const acme = await service.createSelfHostedCustomer({ name: "Acme Corp" });
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
      const acme = await service.createSelfHostedCustomer({ name: "Acme Corp" });

      await expect(service.findRepresentatives({ organizationId: acme.id })).resolves.toEqual([]);
    });
  });
});
