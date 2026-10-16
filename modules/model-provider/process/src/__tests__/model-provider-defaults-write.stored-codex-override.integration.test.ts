/**
 * Real-Postgres coverage for the stored-Codex-override carve-out: a stored Codex
 * value for topic clustering stays savable when another key changes; writing a
 * different Codex value for it is still refused.
 * @vitest-environment node
 * @see modules/topic/specs/model-resolution.feature
 */
import {
  CODEX_DEFAULT_MODEL,
  ModelDefaultValidationError,
} from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ModelProviderDefaultsWriteService } from "../features/defaults/services/model-provider-defaults-write.service.ts";
import { PrismaModelDefaultRepository } from "../repositories/prisma/prisma.model-default.repository.ts";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service.ts";
import { ModelProviderScopeService } from "../services/model-provider-scope.service.ts";
import { ModelProviderWriteAuthorizationService } from "../services/model-provider-write-authorization.service.ts";
import {
  DB_URL,
  TestModelProviderCatalog,
  cleanupTenancyFixture,
  createPrismaProjects,
  createTenancyFixture,
  createTestAuthzApi,
  createTestPrismaClient,
  idService,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support.ts";

const TOPIC_KEY = "analytics.topic_clustering_llm";
const OTHER_CODEX_MODEL = "openai_codex/gpt-5.6-other";

describe.skipIf(!DB_URL)(
  "given a config storing a Codex value for topic clustering (real Postgres)",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const ns = testNamespace("mdcfg-codex");
    let fixture: TenancyFixture;
    let configId: string;

    const writer = ModelProviderDefaultsWriteService.create({
      defaults: PrismaModelDefaultRepository.create(prisma),
      catalog: new TestModelProviderCatalog(),
      writeAuthorization: ModelProviderWriteAuthorizationService.create(
        ModelProviderAuthorizationService.create(
          createTestAuthzApi(async () => ({ permitted: true, organizationRole: null })),
        ),
      ),
      ids: idService,
      scopes: ModelProviderScopeService.create({
        projects: createPrismaProjects(prisma),
        organizations: {
          getTeamById: async (input: { teamId: string }) => {
            const team = await prisma.team.findUniqueOrThrow({ where: { id: input.teamId } });
            return { id: team.id, organizationId: team.organizationId };
          },
        } as never,
      }),
    });

    const storedConfig = async () =>
      (
        await prisma.modelDefaultConfig.findUniqueOrThrow({
          where: { id: configId },
          select: { config: true },
        })
      ).config;

    // Inserted directly: the write path would refuse the Codex value, and the point
    // is a value saved before the restriction existed.
    const seedStoredCodex = async () => {
      const row = await prisma.modelDefaultConfig.create({
        data: {
          organizationId: fixture.organizationId,
          config: { [TOPIC_KEY]: CODEX_DEFAULT_MODEL },
          scopes: { create: [{ scopeType: "PROJECT", scopeId: fixture.projectId }] },
        },
      });
      configId = row.id;
    };

    beforeAll(async () => {
      fixture = await createTenancyFixture(prisma, ns);
    });

    afterEach(async () => {
      await prisma.modelDefaultConfig.deleteMany({
        where: { organizationId: fixture.organizationId },
      });
    });

    afterAll(async () => {
      await cleanupTenancyFixture(prisma, fixture);
      await prisma.$disconnect();
    });

    describe("when the full config is saved back with the stored codex value unchanged", () => {
      /** @scenario "A saved Codex clustering override does not block other default-model changes" */
      it("saves the change and keeps the stored codex value untouched", async () => {
        await seedStoredCodex();

        await writer.save({
          id: configId,
          config: { [TOPIC_KEY]: CODEX_DEFAULT_MODEL, FAST: "openai/gpt-5-mini" },
          scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
        } as never);

        expect(await storedConfig()).toEqual({
          [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
          FAST: "openai/gpt-5-mini",
        });
      });
    });

    describe("when a single role is set at the scope", () => {
      /** @scenario "A saved Codex clustering override does not block other default-model changes" */
      it("saves the role and keeps the stored codex value untouched", async () => {
        await seedStoredCodex();

        await writer.set({
          scope: { scopeType: "PROJECT", scopeId: fixture.projectId },
          key: "FAST",
          model: "openai/gpt-5-mini",
        } as never);

        expect(await storedConfig()).toEqual({
          [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
          FAST: "openai/gpt-5-mini",
        });
      });
    });

    describe("when a different codex value is written for topic clustering", () => {
      /** @scenario "Saving a new Codex model for topic clustering is still rejected" */
      it("rejects with a validation error and leaves the row unchanged", async () => {
        await seedStoredCodex();

        await expect(
          writer.save({
            id: configId,
            config: { [TOPIC_KEY]: OTHER_CODEX_MODEL },
            scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
          } as never),
        ).rejects.toBeInstanceOf(ModelDefaultValidationError);

        expect(await storedConfig()).toEqual({ [TOPIC_KEY]: CODEX_DEFAULT_MODEL });
      });
    });
  },
);
