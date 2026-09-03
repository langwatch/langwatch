/**
 * @vitest-environment node
 *
 * @see specs/features/onboarding/intent-fork.feature
 * @see specs/ai-governance/personal-portal/default-catalog.feature
 *
 * Moved from `onboarding.personal-workspace.integration.test.ts` on
 * platform/app. The full ceremony that file drove through the deleted
 * `onboardingRouter` (organization creation, AI tool catalog seeding,
 * personal-workspace provisioning by intent) is exercised at the transport's
 * own port-call boundary in `onboarding.api.unit.test.ts` — see the
 * `@scenario` tags there for the governance/LLM-app intent split and the
 * catalog call. What is left as this package's own DB-backed invariant is
 * `ensurePersonalWorkspace`'s idempotency: a second CLI login (or the portal's
 * own lazy backfill) must not mint a second personal team for the same
 * (organization, owner) pair.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the
 * suite stays runnable on a box with no database.
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { type PrismaClient } from "@langwatch/prisma-client/generated";
import { PersonalWorkspaceIdentityAdapter } from "../../../adapters/resource-identifiers.adapter";
import { PrismaOrganizationRepository } from "../prisma.organization.repository";
import type { OrganizationSettingsSecretPort } from "../../../ports/organization.port";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const passthroughSecrets: OrganizationSettingsSecretPort = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};

describe.skipIf(!DB_URL)("PrismaOrganizationRepository.ensurePersonalWorkspace", () => {
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient | undefined;
  let organizationRepository: PrismaOrganizationRepository;
  const identities = PersonalWorkspaceIdentityAdapter.create();
  const testNamespace = `ensure-idempotent-${nanoid(8)}`;

  connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  prisma = connection.client as PrismaClient;
  organizationRepository = PrismaOrganizationRepository.create(prisma, passthroughSecrets);

  let organizationId: string;
  let userId: string;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { team: { organizationId } } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("given the user picked the coding-agent tracking intent", () => {
    /** @scenario The personal workspace stays separate from the shared workspace */
    it("is idempotent, so a later CLI login adds no second workspace", async () => {
      const user = await prisma!.user.create({
        data: { name: "Governance User", email: `governance-${testNamespace}@example.com` },
      });
      userId = user.id;

      const organization = await prisma!.organization.create({
        data: { name: `ACME Governance ${testNamespace}`, slug: `--test-org-${testNamespace}` },
      });
      organizationId = organization.id;

      const ensure = () =>
        organizationRepository.ensurePersonalWorkspace({
          workspace: { userId, organizationId, displayName: "Governance User" },
          resources: identities.create({ userId, organizationId }),
        });

      const first = await ensure();
      expect(first.created).toBe(true);

      const second = await ensure();
      expect(second.created).toBe(false);
      expect(second.workspace.team.id).toBe(first.workspace.team.id);

      await expect(
        prisma!.team.count({ where: { organizationId, isPersonal: true } }),
      ).resolves.toBe(1);
    });
  });
});
