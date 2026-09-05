/**
 * Real-Postgres cover for the onboarding seed's per-key merge (main #7556): the seed used to stop at the first config already attached to a scope, so the order providers were added in decided which roles ever existed — an Anthropic-first organization got DEFAULT and FAST and no EMBEDDINGS, and adding OpenAI afterwards did nothing at all.
 * @vitest-environment node
 * @see specs/model-providers/onboarding-flow.feature
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderOnboardingDefaultsService } from "../services/model-provider-onboarding-defaults.service";
import { ModelProviderScopeService } from "../services/model-provider-scope.service";
import { ModelProviderCommandService } from "../services/model-provider-command.service";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service";
import { ModelProviderWriteAuthorizationService } from "../services/model-provider-write-authorization.service";
import { ModelProviderKeysService } from "../services/model-provider-keys.service";
import { PrismaModelDefaultRepository } from "../repositories/prisma/prisma.model-default.repository";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository";
import {
  DB_URL,
  IdentityModelProviderCredentialCodec,
  PrismaProjects,
  TestModelProviderCatalog,
  cleanupTenancyFixture,
  createTenancyFixture,
  createTestPrismaClient,
  idService,
  noopConnectionRateLimiter,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support";

const alwaysPermitAuthz = {
  getDecision: async () => ({ permitted: true }),
} as unknown as AuthzService;

describe.skipIf(!DB_URL)(
  "ModelProviderOnboardingDefaultsService.seed merge (real Postgres)",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const defaults = PrismaModelDefaultRepository.create(prisma);
    const scopes = ModelProviderScopeService.create({
      projects: new PrismaProjects(prisma),
      organizations: {
        getBillingProfile: async (input: { organizationId: string }) => ({
          id: input.organizationId,
        }),
      } as never,
    });
    const onboardingDefaults = ModelProviderOnboardingDefaultsService.create({
      defaults,
      ids: idService,
      scopes,
    });

    const ns = testNamespace("seed-merge");
    let fixture: TenancyFixture;

    beforeAll(async () => {
      fixture = await createTenancyFixture(prisma, ns);
    });

    afterAll(async () => {
      await cleanupTenancyFixture(prisma, fixture);
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      await prisma.modelDefaultConfig.deleteMany({
        where: { organizationId: fixture.organizationId },
      });
    });

    /** The single config attached at the organization scope, as stored. */
    async function storedConfig(): Promise<Record<string, string>> {
      const config = await defaults.tryFindByScope({
        scopeType: "ORGANIZATION",
        scopeId: fixture.organizationId,
      });
      if (!config) throw new Error("expected a config at the organization scope, found none");
      return config.config as Record<string, string>;
    }

    const seedAnthropicOnly = () =>
      onboardingDefaults.seed({
        provider: "anthropic",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
      });
    const seedOpenAi = () =>
      onboardingDefaults.seed({
        provider: "openai",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
      });

    describe("when a provider that fills a missing role is enabled after it", () => {
      /** @scenario Seeding a scope that already has a config adds only the missing roles */
      it("adds EMBEDDINGS and leaves the roles the scope already had", async () => {
        await seedAnthropicOnly();
        const before = await storedConfig();
        expect(before.EMBEDDINGS).toBeUndefined();

        await seedOpenAi();

        const after = await storedConfig();
        expect(after.EMBEDDINGS).toMatch(/^openai\/text-embedding-/);
        expect(after.DEFAULT).toBe(before.DEFAULT);
        expect(after.FAST).toBe(before.FAST);
      });
    });

    describe("when every role the provider seeds is already set", () => {
      /** @scenario A role the scope already carries is never rewritten */
      it("changes no value", async () => {
        await seedOpenAi();
        const before = await storedConfig();

        await seedOpenAi();

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
        const repository = PrismaModelProviderRepository.create(
          prisma,
          new IdentityModelProviderCredentialCodec(),
        );
        const writeAuthorization = ModelProviderWriteAuthorizationService.create(
          ModelProviderAuthorizationService.create(alwaysPermitAuthz),
        );
        const command = ModelProviderCommandService.create({
          repository,
          scopes,
          writeAuthorization,
          credentialPolicy: ModelProviderKeysService.create(),
          catalog: new TestModelProviderCatalog(),
          connectionRateLimiter: noopConnectionRateLimiter,
          onboardingDefaults,
          ids: idService,
          defaults: {} as never,
        } as never);

        const created = await command.upsert({
          organizationId: fixture.organizationId,
          actorId: fixture.adminUserId,
          provider: "openai",
          enabled: false,
          customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        } as never);

        // The create path seeds too, so start from the Anthropic-only shape the
        // scenario reproduces on: DEFAULT + FAST, no EMBEDDINGS.
        await prisma.modelDefaultConfig.deleteMany({
          where: { organizationId: fixture.organizationId },
        });
        await seedAnthropicOnly();
        expect((await storedConfig()).EMBEDDINGS).toBeUndefined();

        await command.upsert({
          id: created.id,
          organizationId: fixture.organizationId,
          actorId: fixture.adminUserId,
          provider: "openai",
          enabled: true,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: fixture.organizationId }],
        } as never);

        expect((await storedConfig()).EMBEDDINGS).toMatch(/^openai\/text-embedding-/);
      });
    });
  },
);
