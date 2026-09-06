/**
 * @vitest-environment node
 *
 * Real-Postgres cover for the onboarding seed's per-key merge (#7556).
 *
 * The seed used to stop at the first config already attached to the scope, so
 * the order the providers were added in decided which roles ever existed: an
 * Anthropic-first organization got DEFAULT and FAST and no EMBEDDINGS, and
 * adding OpenAI afterwards did nothing at all. Every embeddings feature then
 * refused with model_not_configured while two providers sat there enabled.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { prisma } from "../../db";
import { ModelDefaultsRepository } from "../modelDefaults.repository";
import { ModelProviderService } from "../modelProvider.service";
import { seedOnboardingDefaultsForProvider } from "../seedOnboardingDefaults";

wireDefaultTestApp();

const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(!hasCredentialsSecret)(
  "given the onboarding seed running at a scope that already has defaults",
  () => {
    const ns = `seed-merge-${nanoid(8)}`;
    // A const, and the row is created with it rather than reading it back: the
    // deleteMany below filters on this id, and a `let` assigned in `beforeAll`
    // is undefined whenever setup threw first, which Prisma drops from the
    // filter so the delete matches every row (#6219).
    const organizationId = `organization_${ns}`;

    let teamId: string;
    let projectId: string;
    let orgAdminUserId: string;

    beforeAll(async () => {
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: `Seed Merge Org ${ns}`,
          slug: `--test-${ns}`,
        },
      });

      const team = await prisma.team.create({
        data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
      });
      teamId = team.id;

      const project = await prisma.project.create({
        data: {
          name: `Project ${ns}`,
          slug: `--proj-${ns}`,
          teamId: team.id,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-${ns}`,
        },
      });
      projectId = project.id;

      const orgAdmin = await prisma.user.create({
        data: { name: "Org Admin", email: `org-admin-${ns}@example.com` },
      });
      orgAdminUserId = orgAdmin.id;
      await prisma.organizationUser.create({
        data: {
          userId: orgAdmin.id,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: orgAdmin.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["modelDefaultConfig", { organizationId }],
        [
          "modelProvider",
          {
            scopes: {
              some: { scopeType: "ORGANIZATION", scopeId: organizationId },
            },
          },
        ],
        ["roleBinding", { organizationId }],
        ["organizationUser", { organizationId }],
        ["user", { id: orgAdminUserId }],
        ["project", { id: projectId }],
        ["team", { id: teamId }],
        ["organization", { id: organizationId }],
      ]);
    });

    beforeEach(async () => {
      await cleanupTestRows(prisma, [
        ["modelDefaultConfig", { organizationId }],
        [
          "modelProvider",
          {
            scopes: {
              some: { scopeType: "ORGANIZATION", scopeId: organizationId },
            },
          },
        ],
      ]);
    });

    /**
     * The single config attached at the organization scope, as stored.
     *
     * The count is a precondition of the helper rather than a claim of any one
     * case: every case here reads one config, so a second one means the setup
     * drifted and each assertion below would be reading an arbitrary half of
     * the answer. It throws rather than asserts, so the failure names the
     * setup instead of pointing at whichever case ran first.
     */
    const storedConfig = async (): Promise<Record<string, string>> => {
      const configs = await new ModelDefaultsRepository(
        prisma,
      ).findConfigsAtScope("ORGANIZATION", organizationId);
      if (configs.length !== 1) {
        throw new Error(
          `expected exactly one config at the organization scope, found ${configs.length}`,
        );
      }
      return (configs[0]!.config ?? {}) as Record<string, string>;
    };

    const seedAnthropicOnly = async () => {
      await seedOnboardingDefaultsForProvider({
        prisma,
        provider: "anthropic",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      });
    };

    describe("when a provider that fills a missing role is enabled after it", () => {
      /** @scenario Seeding a scope that already has a config adds only the missing roles */
      it("adds EMBEDDINGS and leaves the roles the scope already had", async () => {
        await seedAnthropicOnly();
        const before = await storedConfig();
        expect(before.EMBEDDINGS).toBeUndefined();

        await seedOnboardingDefaultsForProvider({
          prisma,
          provider: "openai",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        });

        const after = await storedConfig();
        expect(after.EMBEDDINGS).toMatch(/^openai\/text-embedding-/);
        expect(after.DEFAULT).toBe(before.DEFAULT);
        expect(after.FAST).toBe(before.FAST);
      });
    });

    describe("when every role the provider seeds is already set", () => {
      /** @scenario A role the scope already carries is never rewritten */
      it("changes no value", async () => {
        await seedOnboardingDefaultsForProvider({
          prisma,
          provider: "openai",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        });
        const before = await storedConfig();

        await seedOnboardingDefaultsForProvider({
          prisma,
          provider: "openai",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        });

        expect(await storedConfig()).toEqual(before);
      });
    });

    describe("when the provider's plan adds nothing the scope is missing", () => {
      /** @scenario A provider whose plan adds nothing new leaves the config untouched */
      it("leaves the stored config unchanged", async () => {
        await seedAnthropicOnly();
        const before = await storedConfig();

        await seedAnthropicOnly();

        expect(await storedConfig()).toEqual(before);
      });
    });

    describe("when a provider that was turned off is turned back on", () => {
      /** @scenario Enabling a provider that was turned off seeds the roles it can fill */
      it("seeds the roles it can fill on the enable flip", async () => {
        const service = ModelProviderService.create(prisma);
        const ctx = {
          prisma,
          session: {
            user: {
              id: orgAdminUserId,
              email: `org-admin-${ns}@example.com`,
              name: "Org Admin",
            },
            expires: "2099-01-01T00:00:00.000Z",
          } as any,
        };

        const created = await service.updateModelProvider(
          {
            projectId,
            provider: "openai",
            enabled: false,
            customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          },
          ctx,
        );

        // The create path seeds too, so start from the Anthropic-only shape the
        // bug reproduces on: DEFAULT + FAST, no EMBEDDINGS.
        await prisma.modelDefaultConfig.deleteMany({
          where: { organizationId },
        });
        await seedAnthropicOnly();
        expect((await storedConfig()).EMBEDDINGS).toBeUndefined();

        await service.updateModelProvider(
          {
            id: created.id,
            projectId,
            provider: "openai",
            enabled: true,
            scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          },
          ctx,
        );

        expect((await storedConfig()).EMBEDDINGS).toMatch(
          /^openai\/text-embedding-/,
        );
      });
    });
  },
);
