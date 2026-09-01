import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import {
  GroupIdentityPort,
  OrganizationSettingsSecretPort,
  PersonalWorkspaceIdentityPort,
  PostgresOrganizationAdapter,
  TeamIdentityPort,
  type PersonalWorkspaceResourceIds,
} from "@langwatch/organization-server";
import { prisma } from "~/server/db";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

/**
 * The settings write belongs to the organization feature, so the intent edits
 * below drive ITS service against the same database rather than a second copy
 * of the write in this process.
 *
 * The identity, authorization and grant collaborators the adapter composes are
 * untouched by a settings write — it reads the organization row, writes the
 * organization row, and speaks to nothing else — so they are inert here and a
 * failure would name this write rather than one of them. Nothing needs a real
 * cipher either: no S3 credential is written, so the secret port is identity.
 */
class PassthroughSettingsSecrets extends OrganizationSettingsSecretPort {
  encrypt(value: string): string {
    return value;
  }

  decrypt(value: string): string {
    return value;
  }
}

class UnusedIdentities extends PersonalWorkspaceIdentityPort {
  create(): PersonalWorkspaceResourceIds {
    throw new Error("A settings write creates no personal workspace");
  }
}

class UnusedTeamIdentities extends TeamIdentityPort {
  createTeam(): { teamId: string; slug: string } {
    throw new Error("A settings write creates no team");
  }

  createBindingId(): string {
    throw new Error("A settings write creates no binding");
  }
}

class UnusedGroupIdentities extends GroupIdentityPort {
  createGroupId(): string {
    throw new Error("A settings write creates no group");
  }

  createBindingId(): string {
    throw new Error("A settings write creates no binding");
  }

  slugify(): string {
    throw new Error("A settings write slugs nothing");
  }
}

/**
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
 * Pairs with: specs/features/onboarding/intent-fork.feature
 */
describe("PrismaOrganizationRepository.createAndAssign — primaryIntent", () => {
  const repository = new PrismaOrganizationRepository(prisma);
  const settings = PostgresOrganizationAdapter.create({
    database: prisma,
    identities: new UnusedIdentities(),
    teamIdentities: new UnusedTeamIdentities(),
    groupIdentities: new UnusedGroupIdentities(),
    authz: {} as AuthzService,
    grants: {} as AuthzGrantsService,
    settingsSecrets: new PassthroughSettingsSecrets(),
  }).build();
  const testNamespace = `intent-${nanoid(8)}`;
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createUser() {
    const user = await prisma.user.create({
      data: {
        email: `${nanoid(8)}@${testNamespace}.test`,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createOrg(params: {
    primaryIntent?: "AGENT_GOVERNANCE" | "LLM_OPS" | null;
  }) {
    const user = await createUser();
    const suffix = nanoid(6).toLowerCase();
    const result = await repository.createAndAssign({
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
  });

  describe("when the governance intent is declared", () => {
    /** @scenario "Governance signup records the organization's primary intent" */
    it("persists the intent on the organization row within the create", async () => {
      const result = await createOrg({ primaryIntent: "AGENT_GOVERNANCE" });

      const organization = await prisma.organization.findUnique({
        where: { id: result.organization.id },
        select: { primaryIntent: true },
      });
      expect(organization?.primaryIntent).toBe("AGENT_GOVERNANCE");
    });
  });

  describe("when no intent is declared (legacy callers)", () => {
    it("persists NULL", async () => {
      const result = await createOrg({});

      const organization = await prisma.organization.findUnique({
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
          await prisma.organization.findUnique({
            where: { id: orgId },
            select: { primaryIntent: true },
          })
        )?.primaryIntent;

      // undefined leaves the current value untouched
      await settings.updateSettings({
        organizationId: orgId,
        name: "Renamed",
      });
      expect(await readIntent()).toBe("AGENT_GOVERNANCE");

      await settings.updateSettings({
        organizationId: orgId,
        name: "Renamed",
        primaryIntent: "LLM_OPS",
      });
      expect(await readIntent()).toBe("LLM_OPS");

      // null clears back to legacy behavior
      await settings.updateSettings({
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
});
