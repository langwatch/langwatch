/**
 * @vitest-environment node
 *
 * @see specs/model-providers/providers-without-a-project.feature
 *
 * Real-Postgres coverage for the provider write path on an organization
 * that has no project at all. A provider belongs to an organization and
 * reaches the scopes attached to it, so nothing on the write path needs a
 * project — `tryResolveAnchor` short-circuits on `organizationId` before it
 * ever looks at `projectId`. `model-provider-command.delete.unit.test.ts`
 * pins that against a mocked `scopes` port; only real Postgres proves the
 * write actually lands with no project row anywhere near it.
 *
 * The probe scenarios ("A read-only member cannot probe...", "Checking a
 * credential for a scope I can manage") are ported against
 * `ModelProviderCommandService.testConnection` — the current architecture's
 * check-an-already-saved-credential seam — rather than main's deleted
 * `modelProvider.validateApiKey` route, which probed an arbitrary
 * caller-supplied URL directly against caller-supplied scopes. That route no
 * longer exists in this shape; `testConnection`'s own doc comment says it
 * "checks a credential that is already saved", which is the same property
 * these scenarios describe.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderCommandService } from "../model-provider-command.service";
import { ModelProviderAuthorizationService } from "../model-provider-authorization.service";
import { ModelProviderWriteAuthorizationService } from "../model-provider-write-authorization.service";
import { ModelProviderScopeService } from "../model-provider-scope.service";
import { ModelProviderKeysService } from "../model-provider-keys.service";
import { PrismaModelProviderRepository } from "../../repositories/prisma/prisma.model-provider.repository";
import {
  DB_URL,
  IdentityModelProviderCredentialCodec,
  PrismaProjects,
  TestModelProviderCatalog,
  buildModelProvider,
  createTestPrismaClient,
  idService,
  noopConnectionRateLimiter,
  noopOnboardingDefaults,
  testNamespace,
} from "./support/model-provider-integration.support";

type Role = "ADMIN" | "MEMBER";

/**
 * Computes decisions from a real per-user/organization role table, the way
 * `AuthzService` does, instead of echoing whatever the test wants: ADMIN
 * holds every manage permission at its own organization, MEMBER holds none.
 * A user with no row in the table is a stranger to every organization.
 */
function roleComputingAuthz(roles: Record<string, { organizationId: string; role: Role }>) {
  return {
    getDecision: async (input: {
      userId: string;
      permission: string;
      scope: { tier: string; id: string };
    }) => {
      const membership = roles[input.userId];
      if (!membership || membership.organizationId !== input.scope.id) {
        return { permitted: false };
      }
      const manages = input.permission.endsWith(":manage");
      return { permitted: membership.role === "ADMIN" && manages };
    },
  } as unknown as AuthzService;
}

describe.skipIf(!DB_URL)(
  "ModelProviderCommandService on an organization with no project (real Postgres)",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const repository = PrismaModelProviderRepository.create(
      prisma,
      new IdentityModelProviderCredentialCodec(),
    );
    const scopes = ModelProviderScopeService.create({
      projects: new PrismaProjects(prisma),
      organizations: {
        getBillingProfile: async (input: { organizationId: string }) => ({ id: input.organizationId }),
      } as never,
    });

    const ns = testNamespace("mp-noproj");
    let organizationId: string;
    let teamId: string;
    let outsiderOrganizationId: string;
    const adminUserId = `admin-${ns}`;
    const memberUserId = `member-${ns}`;
    const outsiderUserId = `outsider-${ns}`;

    function commandFor(userId: string, catalog: TestModelProviderCatalog = new TestModelProviderCatalog()) {
      const authz = roleComputingAuthz({
        [adminUserId]: { organizationId, role: "ADMIN" },
        [memberUserId]: { organizationId, role: "MEMBER" },
        [outsiderUserId]: { organizationId: outsiderOrganizationId, role: "ADMIN" },
      });
      const writeAuthorization = ModelProviderWriteAuthorizationService.create(
        ModelProviderAuthorizationService.create(authz),
      );
      return {
        catalog,
        command: ModelProviderCommandService.create({
          repository,
          scopes,
          writeAuthorization,
          credentialPolicy: ModelProviderKeysService.create(),
          catalog,
          connectionRateLimiter: noopConnectionRateLimiter,
          onboardingDefaults: noopOnboardingDefaults,
          ids: idService,
          defaults: {} as never,
        } as never),
      };
    }

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `NoProj Org ${ns}`, slug: `--noproj-${ns}` },
      });
      organizationId = organization.id;
      const team = await prisma.team.create({
        data: { name: `NoProj Team ${ns}`, slug: `--noproj-team-${ns}`, organizationId },
      });
      teamId = team.id;
      const outsiderOrganization = await prisma.organization.create({
        data: { name: `NoProj Outsider ${ns}`, slug: `--noproj-outsider-${ns}` },
      });
      outsiderOrganizationId = outsiderOrganization.id;
    });

    afterAll(async () => {
      for (const org of [organizationId, outsiderOrganizationId]) {
        const providerIds = (
          await prisma.modelProvider.findMany({ where: { organizationId: org }, select: { id: true } })
        ).map((p) => p.id);
        await prisma.modelProviderScope.deleteMany({ where: { modelProviderId: { in: providerIds } } });
        await prisma.modelProvider.deleteMany({ where: { organizationId: org } });
      }
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: { in: [organizationId, outsiderOrganizationId] } } });
      await prisma.$disconnect();
    });

    it("has no project, which is the state under test", async () => {
      const count = await prisma.project.count({ where: { team: { organizationId } } });
      expect(count).toBe(0);
    });

    describe("given an org admin whose organization has no project", () => {
      /** @scenario "Saving the credential stores it against the organization" */
      it("stores it against the organization", async () => {
        const { command } = commandFor(adminUserId);

        const created = await command.upsert({
          organizationId,
          actorId: adminUserId,
          provider: "openai",
          name: `Create OpenAI ${ns}`,
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-noproject-create" },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        } as never);

        const stored = await prisma.modelProvider.findUnique({
          where: { id: created.id },
          include: { scopes: true },
        });
        expect(stored?.organizationId).toBe(organizationId);
        expect(stored?.scopes).toEqual([
          expect.objectContaining({ scopeType: "ORGANIZATION", scopeId: organizationId }),
        ]);

        const projectCount = await prisma.project.count({ where: { team: { organizationId } } });
        expect(projectCount).toBe(0);
      });
    });

    describe("given an org admin who already added a provider", () => {
      /** @scenario "Changing the credential on it" */
      it("updates the same row instead of creating a second one", async () => {
        const { command } = commandFor(adminUserId);

        const created = await command.upsert({
          organizationId,
          actorId: adminUserId,
          provider: "anthropic",
          name: `Edit Anthropic ${ns}`,
          enabled: true,
          customKeys: { ANTHROPIC_API_KEY: "sk-noproject-original" },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        } as never);

        const updated = await command.upsert({
          id: created.id,
          organizationId,
          actorId: adminUserId,
          provider: "anthropic",
          name: `Edit Anthropic ${ns}`,
          enabled: false,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        } as never);

        expect(updated.id).toBe(created.id);
        const count = await prisma.modelProvider.count({
          where: { organizationId, provider: "anthropic" },
        });
        expect(count).toBe(1);
        const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
        expect(row?.enabled).toBe(false);
      });
    });

    describe("given someone who does not manage the organization", () => {
      /** @scenario "Adding a provider for an organization I do not manage" */
      it("refuses the create and stores nothing", async () => {
        const { command } = commandFor(outsiderUserId);
        const before = await prisma.modelProvider.count({ where: { organizationId } });

        await expect(
          command.upsert({
            organizationId,
            actorId: outsiderUserId,
            provider: "openai",
            name: `Intruder OpenAI ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-intruder" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          } as never),
        ).rejects.toMatchObject({
          code: "model_provider_scope_forbidden",
          meta: { scopeType: "ORGANIZATION", requiredPermission: "organization:manage" },
        });

        const after = await prisma.modelProvider.count({ where: { organizationId } });
        expect(after).toBe(before);
      });

      /** @scenario "Assigning a provider to a scope I do not control" */
      it("refuses the whole write when one scope is unmanageable", async () => {
        const { command } = commandFor(outsiderUserId);
        const before = await prisma.modelProvider.count({ where: { organizationId: outsiderOrganizationId } });

        await expect(
          command.upsert({
            organizationId: outsiderOrganizationId,
            actorId: outsiderUserId,
            provider: "openai",
            name: `Reaching OpenAI ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-reaching" },
            scopes: [
              { scopeType: "ORGANIZATION", scopeId: outsiderOrganizationId },
              { scopeType: "TEAM", scopeId: teamId },
            ],
          } as never),
        ).rejects.toMatchObject({
          code: "model_provider_scope_forbidden",
          meta: { scopeType: "TEAM", requiredPermission: "team:manage" },
        });

        const after = await prisma.modelProvider.count({ where: { organizationId: outsiderOrganizationId } });
        expect(after).toBe(before);
      });
    });

    describe("given a stored provider and a read-only member of its organization", () => {
      /** @scenario "A read-only member cannot probe an arbitrary URL" */
      it("refuses the check before the catalog is ever asked to connect", async () => {
        const { command: adminCommand } = commandFor(adminUserId);
        const created = await repository.create(
          buildModelProvider({
            name: `Probe Target ${ns}`,
            provider: "custom",
            organizationId,
            customKeys: { CUSTOM_API_KEY: "x", CUSTOM_BASE_URL: "https://example.invalid/v1" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          }),
        );
        void adminCommand;

        const { command: memberCommand, catalog } = commandFor(memberUserId);

        await expect(
          memberCommand.testConnection({
            organizationId,
            actorId: memberUserId,
            modelProviderId: created.id,
          } as never),
        ).rejects.toMatchObject({
          code: "model_provider_scope_forbidden",
          meta: { scopeType: "ORGANIZATION", requiredPermission: "organization:manage" },
        });

        expect(catalog.testConnectionCalls).toEqual([]);
      });

      /** @scenario "Checking a credential for a scope I can manage" */
      it("lets an org admin through to the catalog", async () => {
        const created = await repository.create(
          buildModelProvider({
            name: `Probe Target Admin ${ns}`,
            provider: "custom",
            organizationId,
            customKeys: { CUSTOM_API_KEY: "x", CUSTOM_BASE_URL: "https://example.invalid/v1" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          }),
        );

        const { command, catalog } = commandFor(adminUserId);

        const verdict = await command.testConnection({
          organizationId,
          actorId: adminUserId,
          modelProviderId: created.id,
        } as never);

        expect(catalog.testConnectionCalls).toHaveLength(1);
        expect(catalog.testConnectionCalls[0]?.provider).toBe("custom");
        expect(verdict).toBeDefined();
      });
    });
  },
);
