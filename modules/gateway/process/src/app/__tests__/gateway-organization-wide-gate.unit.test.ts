import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { GatewayRequestCredential } from "@langwatch/gateway-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ResourceScope } from "@langwatch/process";
import type { Encryption } from "@langwatch/process-stores";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { GatewayModule } from "../gateway.app.ts";

const ORGANIZATION_ID = "organization_1";
const PROJECT_ID = "project_caller";

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

const reversible: Encryption = {
  encrypt: (plaintext) => `sealed:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace(/^sealed:/, ""),
};

function gatewayApp(authz: Partial<AuthzApi>): Promise<GatewayModule> {
  return GatewayModule.create({
    dependencies: {
      entitlement: createApiFixture({}),
      authz: createApiFixture<AuthzApi>(authz),
      projects: createApiFixture({}),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture({}),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
      apiKeys: createApiFixture({}),
    },
    members: {
      prisma: createApiFixture<PrismaClient>({}),
      clickhouse: createApiFixture<ClickHouseQueryClient>({}),
      encryption: reversible,
      redis: memoryRedisDouble(),
      publicBaseUrl: "https://app.acme.example",
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: void 0,
      publicUrl: void 0,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
}

const scopedKey: GatewayRequestCredential = {
  kind: "apiKey",
  apiKeyId: "key_1",
  userId: "user_1",
  organizationId: ORGANIZATION_ID,
};

async function createBudgetGate({
  app,
  credential,
}: {
  app: GatewayModule;
  credential: GatewayRequestCredential;
}): Promise<void> {
  const { actor } = app.actorForCredential({ projectId: PROJECT_ID, credential });

  await app.authorizeOrganizationWideOperation({
    actor,
    organizationId: ORGANIZATION_ID,
    permission: "gatewayBudgets:create",
  });
}

describe("the gateway's organization-wide gate", () => {
  describe("given a scoped API key", () => {
    /** @scenario "The organization-wide gate asks the key and its owner at the organization" */
    it("asks for that key and its owner at the organization, and admits a holder", async () => {
      const asked: unknown[] = [];
      const app = await gatewayApp({
        hasApiKeyPermission: async (check) => {
          asked.push(check);
          return true;
        },
      });

      await createBudgetGate({ app, credential: scopedKey });

      expect(asked).toEqual([
        expect.objectContaining({
          apiKeyId: "key_1",
          userId: "user_1",
          organizationId: ORGANIZATION_ID,
          permission: "gatewayBudgets:create",
          scope: { type: "org", id: ORGANIZATION_ID },
        }),
      ]);
    });

    /** @scenario "The organization-wide gate asks the key and its owner at the organization" */
    it("refuses a key without the grant as permission_denied, 403", async () => {
      const app = await gatewayApp({ hasApiKeyPermission: async () => false });

      await expect(createBudgetGate({ app, credential: scopedKey })).rejects.toMatchObject({
        code: "permission_denied",
        httpStatus: 403,
        meta: { permission: "gatewayBudgets:create", scopeType: "organization" },
      });
    });
  });

  describe("given a legacy project key", () => {
    /** @scenario "A legacy project key writes organization-wide budgets and cache rules" */
    it("admits it at the organization without asking any grant", async () => {
      const app = await gatewayApp({});

      await expect(
        createBudgetGate({ app, credential: { kind: "legacyProjectKey" } }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "A refused virtual-key create is a 403 naming the missing grant" */
    it("still refuses an organization-scoped virtual key as permission_denied, 403", async () => {
      const app = await gatewayApp({});
      const { actor } = app.actorForCredential({
        projectId: PROJECT_ID,
        credential: { kind: "legacyProjectKey" },
      });

      await expect(
        app.authorizeVirtualKeyCreate({
          actor,
          organizationId: ORGANIZATION_ID,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }],
          traceProjectId: undefined,
          guardrailAttachments: undefined,
          callerProjectId: PROJECT_ID,
        }),
      ).rejects.toMatchObject({
        code: "permission_denied",
        httpStatus: 403,
        meta: { permission: "virtualKeys:manage", scopeType: "organization" },
      });
    });
  });
});
