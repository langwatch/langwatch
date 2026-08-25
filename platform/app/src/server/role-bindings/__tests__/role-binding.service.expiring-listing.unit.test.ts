/**
 * @see specs/rbac/expiring-grants.feature
 *
 * What the Access listing shows about a grant that carries the date its
 * access ends. It is REPORTED and never filtered: a binding whose date has
 * passed grants nothing, but it is still a row an admin has to be able to
 * see — to understand why somebody lost access, and to tidy it away.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import type {
  AccessListingBindingRow,
  AccessListingRepository,
} from "~/server/app-layer/authz/repositories/access-listing.repository";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { RoleService } from "~/server/role/role.service";
import { RoleBindingService } from "../role-binding.service";

const ORG = "org_1";
const TEAM = "team_1";
const ENDED = new Date("2026-01-31T23:59:59.000Z");

function listingRow(
  overrides: Partial<AccessListingBindingRow> = {},
): AccessListingBindingRow {
  return {
    id: "rb_1",
    organizationId: ORG,
    userId: "user_1",
    groupId: null,
    apiKeyId: null,
    role: "MEMBER",
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: TEAM,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: null,
    user: {
      id: "user_1",
      name: "Dana",
      email: "dana@example.com",
      image: null,
    },
    group: null,
    apiKey: null,
    customRole: null,
    ...overrides,
  };
}

function makeService(rows: AccessListingBindingRow[]) {
  const prisma = {
    organization: { findMany: vi.fn().mockResolvedValue([]) },
    team: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: TEAM, name: "Support", isPersonal: false }]),
    },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    customRole: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;

  const accessListing = {
    findOrganizationBindings: vi.fn().mockResolvedValue(rows),
  } as unknown as AccessListingRepository;

  return new RoleBindingService({
    prisma,
    repo: {} as unknown as RoleBindingRepository,
    roleService: new RoleService(prisma),
    writer: {} as unknown as GrantsLedgerWriter,
    accessListing,
  });
}

describe("RoleBindingService listForOrg", () => {
  describe("when a binding carries no end date", () => {
    it("reports none", async () => {
      const service = makeService([listingRow()]);

      const [binding] = await service.listForOrg({ organizationId: ORG });

      expect(binding?.expiresAt).toBeNull();
    });
  });

  describe("when a binding's end date has passed", () => {
    /** @scenario "A binding whose access has ended is still listed" */
    it("still lists it, and says when its access ended", async () => {
      const service = makeService([listingRow({ expiresAt: ENDED })]);

      const rows = await service.listForOrg({ organizationId: ORG });

      // Listed, not hidden: the grant confers nothing any more, and the row
      // is the only record an admin has of access that used to exist.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("rb_1");
      expect(rows[0]?.expiresAt).toEqual(ENDED);
    });
  });
});
