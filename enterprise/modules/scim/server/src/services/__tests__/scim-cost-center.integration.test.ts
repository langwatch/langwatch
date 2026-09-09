// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * SCIM costCenter -> department auto-assignment against real Postgres, over
 * Governance's own department service.
 * Spec: specs/ai-gateway/governance/departments.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PostgresDepartmentAdapter } from "@langwatch/enterprise-governance-server/testing";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  type ScimCreateUserRequest,
  type ScimPatchRequest,
} from "@langwatch/enterprise-scim-contract";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { QuietScimSyncLifecycle } from "../../ports/__tests__/support/quiet-scim-sync-lifecycle.ts";
import { PrismaScimRepository } from "../../repositories/prisma/scim.repository.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";

const CORE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

class EnterprisePlan implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Test",
      free: false,
      maxMembers: 100,
      maxMembersLite: 100,
      maxMessagesPerMonth: 1_000,
      canPublish: false,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

describe.skipIf(!databaseUrl)("ScimService department auto-assignment", () => {
  const ns = `scim-dept-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;

  const departments = () => PostgresDepartmentAdapter.create({ database: prisma }).build();

  /**
   * Everything SCIM asks of the user directory, over the same rows: creating
   * and reading a `User` is a plain write here, and nothing in these scenarios
   * changes a profile or an activation.
   */
  const provisioning = (): ScimUserProvisioning => ({
    findByEmail: ({ email }) => prisma.user.findUnique({ where: { email } }),
    tryFindById: ({ id }) => prisma.user.findUnique({ where: { id } }),
    create: ({ name, email }) => prisma.user.create({ data: { name, email } }),
    updateProfile: ({ id, name, email }) =>
      prisma.user.update({ where: { id }, data: { name, email } }),
    deactivate: ({ id }) =>
      prisma.user.update({ where: { id }, data: { deactivatedAt: new Date() } }),
    reactivate: ({ id }) => prisma.user.update({ where: { id }, data: { deactivatedAt: null } }),
  });

  const scim = () => {
    const governance = departments();

    return ScimService.create({
      prisma: PrismaScimRepository.create(prisma),
      writer: new GrantsFake(),
      users: provisioning(),
      auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) },
      governance: {
        departmentResolveByNameOrCreate: (input) => governance.resolveByNameOrCreate(input),
        departmentAssignUser: (input) => governance.assignUser(input),
      },
      entitlements: new EnterprisePlan(),
      lifecycle: new QuietScimSyncLifecycle(),
      provenOffboarding: false,
    });
  };

  const createRequest = (
    email: string,
    costCenter: string | null | undefined,
  ): ScimCreateUserRequest => {
    const base: Record<string, unknown> = {
      schemas: [CORE_SCHEMA],
      userName: email,
      name: { givenName: "Test", familyName: "User" },
      active: true,
    };
    if (costCenter !== undefined) {
      base[SCIM_ENTERPRISE_USER_SCHEMA] = { costCenter };
    }

    return base as ScimCreateUserRequest;
  };

  const membershipFor = async (email: string) => {
    const user = await prisma.user.findFirstOrThrow({ where: { email } });

    return prisma.organizationUser.findUniqueOrThrow({
      where: { userId_organizationId: { userId: user.id, organizationId: ORG_ID } },
    });
  };

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: ORG_ID, name: ns, slug: ORG_ID } });
  }, 60_000);

  afterAll(async () => {
    await prisma.department.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  });

  describe("given an org that provisions users through SCIM", () => {
    /** @scenario A SCIM-provisioned user is assigned from the enterprise costCenter attribute */
    it("assigns the user to the named department carried on the enterprise extension", async () => {
      const engineering = await departments().create({
        organizationId: ORG_ID,
        name: "Engineering",
      });
      const email = `${ns}-eng@example.com`;

      await scim().createUser({
        request: createRequest(email, "Engineering"),
        organizationId: ORG_ID,
      });

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(engineering.id);
    });

    /** @scenario An unrecognized SCIM costCenter creates the department on first use */
    it("creates a department the first time SCIM references it, then assigns it", async () => {
      const email = `${ns}-research@example.com`;

      const before = await prisma.department.findFirst({
        where: { organizationId: ORG_ID, name: "Research", archivedAt: null },
      });
      expect(before).toBeNull();

      await scim().createUser({
        request: createRequest(email, "Research"),
        organizationId: ORG_ID,
      });

      const created = await prisma.department.findFirstOrThrow({
        where: { organizationId: ORG_ID, name: "Research", archivedAt: null },
      });
      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(created.id);
    });

    /** @scenario Updating the SCIM costCenter reassigns the user */
    it("replaces the prior assignment when the IdP updates the costCenter", async () => {
      const marketing = await departments().create({ organizationId: ORG_ID, name: "Marketing" });
      const email = `${ns}-move@example.com`;
      await scim().createUser({
        request: createRequest(email, "Engineering"),
        organizationId: ORG_ID,
      });
      const user = await prisma.user.findFirstOrThrow({ where: { email } });

      const patch: ScimPatchRequest = {
        schemas: [PATCH_SCHEMA],
        Operations: [
          {
            op: "replace",
            path: `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter`,
            value: "Marketing",
          },
        ],
      };
      await scim().updateUser({ id: user.id, organizationId: ORG_ID, patchRequest: patch });

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(marketing.id);
    });

    /** @scenario Clearing the SCIM costCenter unassigns the user */
    it("clears the assignment when the IdP removes the costCenter attribute", async () => {
      const email = `${ns}-clear@example.com`;
      await scim().createUser({
        request: createRequest(email, "Engineering"),
        organizationId: ORG_ID,
      });
      const user = await prisma.user.findFirstOrThrow({ where: { email } });

      const patch: ScimPatchRequest = {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: "remove", path: `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter` }],
      };
      await scim().updateUser({ id: user.id, organizationId: ORG_ID, patchRequest: patch });

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBeNull();
    });
  });
});
