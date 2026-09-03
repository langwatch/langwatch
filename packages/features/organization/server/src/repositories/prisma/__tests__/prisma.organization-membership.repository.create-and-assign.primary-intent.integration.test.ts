/**
 * @vitest-environment node
 *
 * ADR-038 I4/I5: `createAndAssign` persists the declared primary intent on
 * the Organization row inside the same create (atomic by construction — no
 * separate write that can fail on its own), produces an identical result
 * shape regardless of intent, and persists NULL when no intent is given
 * (legacy default).
 *
 * Exercised at the repository layer because the tRPC-level
 * initializeOrganization integration tests are env-gated (App singleton
 * requires IS_SAAS + Stripe config) and permanently skipped.
 *
 * Settings updates (the Primary use setting) now live on the canonical
 * organization repository, not the membership one — the two are wired
 * against the same database here since the invariant spans both.
 *
 * Pairs with: specs/features/onboarding/intent-fork.feature
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
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository";
import { PrismaOrganizationRepository } from "../prisma.organization.repository";
import type { OrganizationSettingsSecretPort } from "../../../ports/organization.port";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const noopGrantsWriter = {
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
} as unknown as AuthzGrantsService;

/** No secret ever passes through this suite; the identity is enough. */
const passthroughSecrets: OrganizationSettingsSecretPort = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};

describe.skipIf(!DB_URL)(
  "PrismaOrganizationMembershipRepository.createAndAssign — primaryIntent",
  () => {
    let connection: PrismaConnection | undefined;
    let prisma: PrismaClient | undefined;
    let membershipRepository: PrismaOrganizationMembershipRepository;
    let organizationRepository: PrismaOrganizationRepository;
    const testNamespace = `intent-${nanoid(8)}`;
    const createdOrgIds: string[] = [];
    const createdUserIds: string[] = [];

    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    membershipRepository = PrismaOrganizationMembershipRepository.create({
      database: prisma,
      grants: noopGrantsWriter,
    });
    organizationRepository = PrismaOrganizationRepository.create(prisma, passthroughSecrets);

    async function createUser() {
      const user = await prisma!.user.create({
        data: {
          email: `${nanoid(8)}@${testNamespace}.test`,
        },
      });
      createdUserIds.push(user.id);
      return user;
    }

    async function createOrg(params: { primaryIntent?: "AGENT_GOVERNANCE" | "LLM_OPS" | null }) {
      const user = await createUser();
      const suffix = nanoid(6).toLowerCase();
      const result = await membershipRepository.createAndAssign({
        userId: user.id,
        orgId: `org_${testNamespace}_${suffix}`,
        orgName: `Org ${suffix}`,
        orgSlug: `org-${testNamespace}-${suffix}`,
        teamId: `team_${testNamespace}_${suffix}`,
        teamSlug: `team-${testNamespace}-${suffix}`,
        primaryIntent: params.primaryIntent,
        pricingModel: "SEAT_EVENT",
      });
      createdOrgIds.push(result.organization.id);
      return result;
    }

    afterAll(async () => {
      if (!prisma) return;
      await prisma.teamUser.deleteMany({
        where: { team: { organizationId: { in: createdOrgIds } } },
      });
      await prisma.team.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.organizationUser.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.$disconnect();
    });

    describe("when the governance intent is declared", () => {
      /** @scenario "Governance signup records the organization's primary intent" */
      it("persists the intent on the organization row within the create", async () => {
        const result = await createOrg({ primaryIntent: "AGENT_GOVERNANCE" });

        const organization = await prisma!.organization.findUnique({
          where: { id: result.organization.id },
          select: { primaryIntent: true },
        });
        expect(organization?.primaryIntent).toBe("AGENT_GOVERNANCE");
      });
    });

    describe("when no intent is declared (legacy callers)", () => {
      it("persists NULL", async () => {
        const result = await createOrg({});

        const organization = await prisma!.organization.findUnique({
          where: { id: result.organization.id },
          select: { primaryIntent: true },
        });
        expect(organization?.primaryIntent).toBeNull();
      });
    });

    describe("when the Primary use setting is edited (ADR-038 org setting)", () => {
      it("sets, clears, and leaves the intent untouched per the update contract", async () => {
        const result = await createOrg({ primaryIntent: "AGENT_GOVERNANCE" });
        const orgId = result.organization.id;
        const readIntent = async () =>
          (
            await prisma!.organization.findUnique({
              where: { id: orgId },
              select: { primaryIntent: true },
            })
          )?.primaryIntent;

        // undefined leaves the current value untouched
        await organizationRepository.updateSettings({
          organizationId: orgId,
          name: "Renamed",
        });
        expect(await readIntent()).toBe("AGENT_GOVERNANCE");

        await organizationRepository.updateSettings({
          organizationId: orgId,
          name: "Renamed",
          primaryIntent: "LLM_OPS",
        });
        expect(await readIntent()).toBe("LLM_OPS");

        // null clears back to legacy behavior
        await organizationRepository.updateSettings({
          organizationId: orgId,
          name: "Renamed",
          primaryIntent: null,
        });
        expect(await readIntent()).toBeNull();
      });
    });

    describe("result shape parity across intents (I4)", () => {
      it("returns the same shape regardless of declared intent", async () => {
        const governance = await createOrg({
          primaryIntent: "AGENT_GOVERNANCE",
        });
        const llmops = await createOrg({ primaryIntent: "LLM_OPS" });
        const legacy = await createOrg({});

        for (const result of [governance, llmops, legacy]) {
          expect(Object.keys(result).sort()).toEqual(Object.keys(governance).sort());
          expect(result.organization).toEqual(
            expect.objectContaining({
              id: expect.any(String),
              name: expect.any(String),
            }),
          );
          expect(result.team).toEqual(
            expect.objectContaining({
              id: expect.any(String),
              slug: expect.any(String),
            }),
          );
        }
      });
    });
  },
);
