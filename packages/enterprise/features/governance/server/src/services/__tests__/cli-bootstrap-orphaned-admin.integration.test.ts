/**
 * @vitest-environment node
 *
 * Login completion for an organization whose admin accounts are gone, against
 * real Postgres.
 *
 * `OrganizationUser.user` is backed by no database foreign key (the schema
 * runs `relationMode = "prisma"`), so a membership row outlives the account it
 * points at. Asking for that required relation made ONE dangling ADMIN row
 * reject the whole read with "Inconsistent query result: Field user is
 * required to return data, got null instead", which surfaced as a 500 on the
 * bootstrap route. The CLI then cached nothing, so the wrapper had no tool
 * policies left to enforce — hence the policy-map assertions here beside the
 * admin address itself.
 *
 * Only the contact leg touches the database; the catalog and budget
 * collaborators are substituted, because neither is what the orphan broke.
 *
 * Spec: specs/ai-gateway/governance/cli-login.feature
 */
import {
  PLATFORM_TOOL_POLICY_DEFAULTS,
  PLATFORM_TOOL_SLUGS,
} from "@langwatch/enterprise-governance-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CliAdminContactPort, CliBudgetOverviewPort } from "../../ports/cli-bootstrap.port";
import { DefaultGovernanceCliBootstrapService } from "../cli-bootstrap.service";
import { OrganizationSupportContactService } from "../organization-support-contact.service";
import { PrismaOrganizationSupportContactRepository } from "../../repositories/prisma/prisma.organization-support-contact.repository";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = `cbo-${nanoid(8)}`;
const MIXED_ORG_ID = `org-${ns}`;
const ORPHAN_ONLY_ORG_ID = `org-only-${ns}`;
const CALLER_USER_ID = `usr-${ns}`;
const HEALTHY_ADMIN_ID = `usr-admin-${ns}`;
const HEALTHY_ADMIN_EMAIL = `admin-${ns}@example.com`;
/** Never inserted into User, so this membership dangles. */
const DELETED_ADMIN_ID = `usr-deleted-${ns}`;

/** The orphan joined first, so ordering hands it over before the survivor. */
const ORPHAN_CREATED_AT = new Date("2020-01-01T00:00:00.000Z");
const HEALTHY_CREATED_AT = new Date("2021-01-01T00:00:00.000Z");

class PrismaContacts extends CliAdminContactPort {
  tryResolveAdminEmail(organizationId: string): Promise<string | null> {
    return OrganizationSupportContactService.create({
      repository: PrismaOrganizationSupportContactRepository.create({ prisma }),
    }).resolveOrgAdminEmail({
      organizationId,
    });
  }
}

class MemoryBudgets extends CliBudgetOverviewPort {
  overviewForUser(): Promise<{ gatewayAccess: boolean; budgets: [] }> {
    return Promise.resolve({ gatewayAccess: false, budgets: [] });
  }
}

const catalog = {
  resolveCliCatalogForUser: () =>
    Promise.resolve({
      tools: [],
      providers: [],
      configuredProviderKeys: [],
    }),
  resolveToolPolicyMap: () => Promise.resolve(PLATFORM_TOOL_POLICY_DEFAULTS),
};

describe.skipIf(!databaseUrl)("CLI bootstrap with orphaned admin memberships", () => {
  const service = DefaultGovernanceCliBootstrapService.create({
    catalog,
    budgets: new MemoryBudgets(),
    contacts: new PrismaContacts(),
    gatewayUrl: "https://gateway.example.com",
  });

  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: MIXED_ORG_ID, name: `Mixed ${ns}`, slug: `mixed-${ns}` },
        { id: ORPHAN_ONLY_ORG_ID, name: `Orphaned ${ns}`, slug: `orphaned-${ns}` },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: CALLER_USER_ID, name: `Caller ${ns}`, email: `caller-${ns}@example.com` },
        { id: HEALTHY_ADMIN_ID, name: `Admin ${ns}`, email: HEALTHY_ADMIN_EMAIL },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        {
          organizationId: MIXED_ORG_ID,
          userId: DELETED_ADMIN_ID,
          role: "ADMIN",
          createdAt: ORPHAN_CREATED_AT,
        },
        {
          organizationId: MIXED_ORG_ID,
          userId: HEALTHY_ADMIN_ID,
          role: "ADMIN",
          createdAt: HEALTHY_CREATED_AT,
        },
        { organizationId: MIXED_ORG_ID, userId: CALLER_USER_ID, role: "MEMBER" },
        {
          organizationId: ORPHAN_ONLY_ORG_ID,
          userId: DELETED_ADMIN_ID,
          role: "ADMIN",
          createdAt: ORPHAN_CREATED_AT,
        },
        { organizationId: ORPHAN_ONLY_ORG_ID, userId: CALLER_USER_ID, role: "MEMBER" },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    const organizationIds = [MIXED_ORG_ID, ORPHAN_ONLY_ORG_ID];
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [CALLER_USER_ID, HEALTHY_ADMIN_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }, 60_000);

  describe("given the earliest admin membership outlived its account", () => {
    describe("when the CLI asks for its bootstrap data", () => {
      /** @scenario Login completes when the earliest admin account is gone */
      it("skips the orphan and reports the surviving admin's address", async () => {
        const result = await service.resolve({
          userId: CALLER_USER_ID,
          organizationId: MIXED_ORG_ID,
        });

        expect(result.adminEmail).toBe(HEALTHY_ADMIN_EMAIL);
      });

      /** @scenario Login completes when the earliest admin account is gone */
      it("still hands the CLI a policy entry for every tool it can run", async () => {
        const result = await service.resolve({
          userId: CALLER_USER_ID,
          organizationId: MIXED_ORG_ID,
        });

        for (const slug of PLATFORM_TOOL_SLUGS) {
          expect(result.toolPolicies[slug]).toBeDefined();
        }
      });
    });
  });

  describe("given every admin membership in the organization is orphaned", () => {
    describe("when the CLI asks for its bootstrap data", () => {
      /** @scenario Login completes when every admin account is gone */
      it("offers no address rather than failing the bootstrap", async () => {
        const result = await service.resolve({
          userId: CALLER_USER_ID,
          organizationId: ORPHAN_ONLY_ORG_ID,
        });

        expect(result.adminEmail).toBeNull();
        for (const slug of PLATFORM_TOOL_SLUGS) {
          expect(result.toolPolicies[slug]).toBeDefined();
        }
      });
    });
  });
});
