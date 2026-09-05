/**
 * @vitest-environment node
 *
 * @see specs/model-providers/provider-configuration.feature
 *
 * Real-Postgres coverage for the credential a customer never retyped.
 *
 * Azure's credential schema is `.passthrough()` with every field optional, so
 * a save that names only an extra header used to be accepted without a word
 * and the row came back holding no credentials at all.
 * `ModelProviderKeysService.assertCredentialsCanBeSaved` refuses that shape
 * now; only real Postgres proves the write is actually rolled back rather
 * than partially applied.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderCommandService } from "../services/model-provider-command.service";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service";
import { ModelProviderWriteAuthorizationService } from "../services/model-provider-write-authorization.service";
import { ModelProviderScopeService } from "../services/model-provider-scope.service";
import { ModelProviderKeysService } from "../services/model-provider-keys.service";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository";
import {
  DB_URL,
  IdentityModelProviderCredentialCodec,
  PrismaProjects,
  TestModelProviderCatalog,
  createTenancyFixture,
  cleanupTenancyFixture,
  createTestPrismaClient,
  idService,
  noopConnectionRateLimiter,
  noopOnboardingDefaults,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support";

const alwaysPermitAuthz = {
  getDecision: async () => ({ permitted: true }),
} as unknown as AuthzService;

describe.skipIf(!DB_URL)(
  "ModelProviderCommandService credential preservation (real Postgres)",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const repository = PrismaModelProviderRepository.create(
      prisma,
      new IdentityModelProviderCredentialCodec(),
    );
    const scopes = ModelProviderScopeService.create({
      projects: new PrismaProjects(prisma),
      organizations: {
        getBillingProfile: async (input: { organizationId: string }) => ({
          id: input.organizationId,
        }),
      } as never,
    });
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
      onboardingDefaults: noopOnboardingDefaults,
      ids: idService,
      defaults: {} as never,
    } as never);

    const ns = testNamespace("mp-cred");
    const STORED_KEY = `sk-actual-${ns}`;
    let fixture: TenancyFixture;

    beforeAll(async () => {
      fixture = await createTenancyFixture(prisma, ns);
    });

    afterAll(async () => {
      await cleanupTenancyFixture(prisma, fixture);
      await prisma.$disconnect();
    });

    describe("given an azure provider with stored credentials", () => {
      describe("when the payload carries only an extra header", () => {
        /** @scenario A header-only payload is refused instead of dropping credentials */
        it("is refused and the stored credentials survive", async () => {
          const created = await command.upsert({
            projectId: fixture.projectId,
            actorId: fixture.adminUserId,
            provider: "azure",
            enabled: true,
            customKeys: {
              AZURE_OPENAI_API_KEY: STORED_KEY,
              AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
            },
            scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
          } as never);

          await expect(
            command.upsert({
              projectId: fixture.projectId,
              actorId: fixture.adminUserId,
              id: created.id,
              provider: "azure",
              enabled: true,
              customKeys: { "api-key": "header-secret" },
              scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
            } as never),
          ).rejects.toMatchObject({ code: "model_provider_credentials_would_be_dropped" });

          const stored = await repository.tryFindById({
            id: created.id,
            organizationId: fixture.organizationId,
          });
          expect(stored?.customKeys).toEqual({
            AZURE_OPENAI_API_KEY: STORED_KEY,
            AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
          });
        });
      });
    });
  },
);
