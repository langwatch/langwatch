// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Reading the directory back, page by page. Three invariants only bite once
 * the directory is larger than one page — a settled order, a page that reports
 * what it holds, and a filter honoured or refused — and an `externalId` term
 * resolves only against the connection that asserted it.
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import type { ScimOrganizationUserRecord } from "../../repositories/scim.repository.ts";
import type { ScimDepartmentAssignment } from "../scim-cost-center.service.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const ORGANIZATION = "org-1";
const CONNECTION = "connection-okta";
const OTHER_CONNECTION = "connection-entra";

function person(index: number): { id: string; email: string } {
  return {
    id: `user-${String(index).padStart(4, "0")}`,
    email: `person${index}@acme.com`,
  };
}

function profileOf({ id, email }: { id: string; email: string }): UserProfile {
  return {
    id,
    name: "Alice Smith",
    email,
    emailVerified: false,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    lastLoginAt: null,
    deactivatedAt: null,
  };
}

/**
 * A store that settles its own order, as the repository contract requires: the
 * page is cut from that order, never from whatever arrival order it holds.
 */
function directory({
  people,
  identities = {},
  lookups = [],
}: {
  people: { id: string; email: string }[];
  identities?: Record<string, Record<string, string>>;
  /** Every identifier lookup the listing made, in order. */
  lookups?: { connectionId: string; externalId: string }[];
}) {
  return scimRepositoryFixture({
    findOrganizationUsers: vi.fn(
      async (input: {
        organizationId: string;
        userName?: string;
        userIds?: readonly string[];
        startIndex: number;
        count: number;
      }): Promise<{ rows: ScimOrganizationUserRecord[]; total: number }> => {
        const matched = people
          .toSorted((left, right) => left.id.localeCompare(right.id))
          .filter(
            (candidate) =>
              (input.userName === undefined ||
                candidate.email.toLowerCase() === input.userName.toLowerCase()) &&
              (input.userIds === undefined || input.userIds.includes(candidate.id)),
          );

        return {
          rows: matched
            .slice(input.startIndex - 1, input.startIndex - 1 + input.count)
            .map((candidate) => ({ user: profileOf(candidate), resource: null })),
          total: matched.length,
        };
      },
    ),
    findDirectoryUserId: vi.fn(async (input: { connectionId: string; externalId: string }) => {
      lookups.push(input);

      return identities[input.connectionId]?.[input.externalId] ?? null;
    }),
  });
}

class EnterpriseEntitlements implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function departments(): ScimDepartmentAssignment {
  return {
    departmentResolveByNameOrCreate: vi.fn(async () => ({
      id: "department-1",
      organizationId: ORGANIZATION,
      name: "Engineering",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    departmentAssignUser: vi.fn(async () => undefined),
  };
}

function userService(): ScimUserProvisioning {
  const stored = profileOf(person(0));

  return {
    findById: vi.fn(async () => stored),
    findByEmail: vi.fn(async () => null),
    create: vi.fn(async () => stored),
  };
}

function serviceOver(repository: ReturnType<typeof directory>) {
  return ScimService.create({
    prisma: repository,
    writer: new GrantsFake(),
    users: userService(),
    governance: departments(),
    organization: new OrganizationAdministrationFake(),
    entitlements: new EnterpriseEntitlements(),
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding: false,
    tokenPepper: "scim-test-pepper",
  });
}

describe("reading the directory back", () => {
  describe("given a directory far larger than one page", () => {
    const people = Array.from({ length: 1000 }, (_, index) => person(index));
    const service = () => serviceOver(directory({ people }));

    /** @scenario "Paging through a large directory lists everybody exactly once" */
    it("tiles the directory with no repeats and no gaps", async () => {
      const seen: string[] = [];
      const scim = service();

      for (let startIndex = 1; startIndex <= people.length; startIndex += 100) {
        const page = await scim.listUsers({ organizationId: ORGANIZATION, startIndex, count: 100 });

        seen.push(...page.Resources.map((resource) => resource.id));
      }

      expect(seen).toHaveLength(people.length);
      expect(new Set(seen).size).toBe(people.length);
    });

    /** @scenario "The total is the whole directory, never the page" */
    it("reports the whole directory as the total on every page", async () => {
      const scim = service();

      const first = await scim.listUsers({
        organizationId: ORGANIZATION,
        startIndex: 1,
        count: 25,
      });
      const later = await scim.listUsers({
        organizationId: ORGANIZATION,
        startIndex: 501,
        count: 25,
      });

      expect(first.totalResults).toBe(people.length);
      expect(later.totalResults).toBe(people.length);
    });

    /** @scenario "A start past the end of the directory is an empty page, not a failure" */
    it("answers a start past the end with an empty page that still counts", async () => {
      const page = await service().listUsers({
        organizationId: ORGANIZATION,
        startIndex: people.length + 50,
        count: 100,
      });

      expect(page.Resources).toEqual([]);
      expect(page.itemsPerPage).toBe(0);
      expect(page.totalResults).toBe(people.length);
    });
  });

  describe("given a directory whose size is not a multiple of the page", () => {
    const people = Array.from({ length: 250 }, (_, index) => person(index));

    /** @scenario "A page reports how many resources it actually carries" */
    /** @scenario "The last page reports how many people it actually carries" */
    it("reports the short last page at its real size", async () => {
      const page = await serviceOver(directory({ people })).listUsers({
        organizationId: ORGANIZATION,
        startIndex: 201,
        count: 100,
      });

      expect(page.Resources).toHaveLength(50);
      expect(page.itemsPerPage).toBe(50);
    });

    /** @scenario "A page reports how many resources it actually carries" */
    /** @scenario "A full page reports the whole page" */
    it("reports a full page as full", async () => {
      const page = await serviceOver(directory({ people })).listUsers({
        organizationId: ORGANIZATION,
        startIndex: 1,
        count: 100,
      });

      expect(page.itemsPerPage).toBe(100);
    });

    /** @scenario "A provider that advances by what it was told lands on the end exactly" */
    it("lets a provider advancing by the reported count reach the last person", async () => {
      const scim = serviceOver(directory({ people }));
      const seen: string[] = [];
      let startIndex = 1;

      for (;;) {
        const page = await scim.listUsers({ organizationId: ORGANIZATION, startIndex, count: 100 });

        seen.push(...page.Resources.map((resource) => resource.id));
        if (page.itemsPerPage === 0) break;
        startIndex += page.itemsPerPage;
      }

      expect(seen).toHaveLength(people.length);
      expect(seen.at(-1)).toBe(person(249).id);
    });
  });

  describe("when a filter names the directory's own identifier", () => {
    const people = [person(1), person(2)];
    const identities = {
      [CONNECTION]: { "okta-00u1": person(1).id },
      [OTHER_CONNECTION]: { "entra-9f2": person(2).id },
    };

    /** @scenario "Looking somebody up by the directory's own identifier works" */
    it("finds the one person their directory means by it", async () => {
      const page = await serviceOver(directory({ people, identities })).listUsers({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        filter: 'externalId eq "okta-00u1"',
      });

      expect(page.Resources.map((resource) => resource.id)).toEqual([person(1).id]);
    });

    /** @scenario "One connection cannot find another connection's person by identifier" */
    it("keeps one connection's identifiers out of another's reach", async () => {
      const page = await serviceOver(directory({ people, identities })).listUsers({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        filter: 'externalId eq "entra-9f2"',
      });

      expect(page.Resources).toEqual([]);
      expect(page.totalResults).toBe(0);
    });

    /** @scenario "An identifier the directory has never seen answers with nobody" */
    it("answers an identifier this connection has never seen with nobody", async () => {
      const page = await serviceOver(directory({ people, identities })).listUsers({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        filter: 'externalId eq "okta-unknown"',
      });

      expect(page.Resources).toEqual([]);
      expect(page.totalResults).toBe(0);
    });

    /** @scenario "An identifier the directory has never seen answers with nobody" */
    it("answers nobody when the credential belongs to no connection at all", async () => {
      const lookups: { connectionId: string; externalId: string }[] = [];

      const page = await serviceOver(directory({ people, identities, lookups })).listUsers({
        organizationId: ORGANIZATION,
        connectionId: null,
        filter: 'externalId eq "okta-00u1"',
      });

      expect(page.Resources).toEqual([]);
      expect(lookups).toEqual([]);
    });
  });
});
