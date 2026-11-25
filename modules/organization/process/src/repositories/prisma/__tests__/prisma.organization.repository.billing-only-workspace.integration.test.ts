/**
 * @vitest-environment node
 * A Billing-only member gets no personal workspace: no team, no project (ADR-205).
 * @see ../../../../../../../specs/licensing/billing-only-invite.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PersonalWorkspaceIdentityService } from "../../../features/personal-workspace/services/personal-workspace-identity.service.ts";
import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)(
  "PrismaOrganizationRepository.ensurePersonalWorkspace, Billing only",
  () => {
    const identities = PersonalWorkspaceIdentityService.create();
    const ns = `billing-only-workspace-${nanoid(8)}`;
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:organization:test:billing-only-workspace"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client as PrismaClient;
    const repository = PrismaOrganizationRepository.create({
      database: prisma,
      cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    });

    let organizationId: string;
    let userId: string;

    beforeAll(async () => {
      organizationId = (
        await prisma.organization.create({ data: { name: "Billing Org", slug: `--test-${ns}` } })
      ).id;
      userId = (await prisma.user.create({ data: { email: `payer-${ns}@acme.test` } })).id;
      await prisma.organizationUser.create({
        data: { userId, organizationId, role: OrganizationUserRole.EXTERNAL, billingOnly: true },
      });
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["project", { team: { organizationId } }],
        ["team", { organizationId }],
        ["organizationUser", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: userId }],
      ]);
      await prisma.$disconnect();
    });

    /** @scenario "A Billing-only member is given no team, project or personal workspace" */
    it("refuses, and writes no team or project", async () => {
      await expect(
        repository.ensurePersonalWorkspace({
          workspace: { userId, organizationId, displayName: "Payer" },
          resources: identities.create({ userId, organizationId }),
        }),
      ).rejects.toMatchObject({ code: "billing_only_no_team_access" });

      expect(await prisma.team.count({ where: { organizationId } })).toBe(0);
      expect(await prisma.project.count({ where: { team: { organizationId } } })).toBe(0);
    });
  },
);
