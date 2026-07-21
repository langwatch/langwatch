import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MASKED_KEY_PLACEHOLDER } from "../../../../utils/constants";
import { createInnerTRPCContext } from "../../trpc";
import { modelProviderRouter } from "../modelProviders";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockFindAllAccessibleForProject,
  mockProjectFindUnique,
  mockHasSetupPermission,
} = vi.hoisted(() => ({
  mockFindAllAccessibleForProject: vi.fn(),
  mockProjectFindUnique: vi.fn(),
  mockHasSetupPermission: vi.fn(),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: mockHasSetupPermission,
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

// Keep the module-level prisma (imported by modelProviders.utils) from
// instantiating a real client; this route resolves through ctx.prisma.
vi.mock("~/server/db", () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));

// The repository is where decryption happens: rows come back with
// plaintext customKeys, exactly as in production. Masking is the
// service boundary's job — which is what this suite pins down.
vi.mock("~/server/modelProviders/modelProvider.repository", () => ({
  ModelProviderRepository: class {
    findAllAccessibleForProject = mockFindAllAccessibleForProject;
  },
}));

const PLAINTEXT_OPENAI_KEY = "sk-plaintext-secret-123";
const PLAINTEXT_AWS_SECRET = "aws-secret-access-key-456";
const PLAINTEXT_AZURE_KEY = "azure-subscription-key-789";
const PLAINTEXT_HEADER_SECRET = "Bearer header-bearer-secret-012";

const storedRows = [
  {
    id: "mp_openai",
    name: "OpenAI",
    provider: "openai",
    enabled: true,
    customKeys: {
      OPENAI_API_KEY: PLAINTEXT_OPENAI_KEY,
      OPENAI_BASE_URL: "https://api.openai.com/v1",
    },
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: null,
    scopes: [{ scopeType: "PROJECT", scopeId: "project_123" }],
  },
  {
    id: "mp_bedrock",
    name: "Bedrock",
    provider: "bedrock",
    enabled: true,
    customKeys: {
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: PLAINTEXT_AWS_SECRET,
      AWS_REGION_NAME: "us-east-1",
    },
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: null,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_123" }],
  },
  {
    id: "mp_azure",
    name: "Azure",
    provider: "azure",
    enabled: true,
    customKeys: {
      AZURE_OPENAI_API_KEY: PLAINTEXT_AZURE_KEY,
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
    },
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: [{ key: "Ocp-Apim-Subscription-Key", value: "apim-secret" }],
    scopes: [{ scopeType: "TEAM", scopeId: "team_123" }],
  },
  {
    id: "mp_custom",
    name: "Custom",
    provider: "custom",
    enabled: true,
    customKeys: {
      CUSTOM_API_KEY: "custom-plaintext-key",
      CUSTOM_BASE_URL: "https://llm.internal.example.com/v1",
    },
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: [
      { key: "Authorization", value: PLAINTEXT_HEADER_SECRET },
      { key: "X-Tenant", value: "tenant-42" },
    ],
    scopes: [{ scopeType: "PROJECT", scopeId: "project_123" }],
  },
];

function makeCaller() {
  const ctx = createInnerTRPCContext({
    session: {
      user: { id: "test-user-id" },
      expires: "1",
    },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = {
    project: { findUnique: mockProjectFindUnique },
  } as unknown as PrismaClient;
  return modelProviderRouter.createCaller(ctx);
}

describe("modelProviders.getAllForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockHasSetupPermission.mockResolvedValue(true);
    mockProjectFindUnique.mockResolvedValue({
      id: "project_123",
      createdAt: new Date("2024-01-01"),
    });
    mockFindAllAccessibleForProject.mockResolvedValue(storedRows);
  });

  describe("when a user with project:update permission fetches providers", () => {
    it("masks stored API keys of every provider instead of returning decrypted plaintext", async () => {
      const result = await makeCaller().getAllForProject({
        projectId: "project_123",
      });

      expect(result.openai?.customKeys).toMatchObject({
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
      });
      expect(result.bedrock?.customKeys).toMatchObject({
        AWS_ACCESS_KEY_ID: MASKED_KEY_PLACEHOLDER,
        AWS_SECRET_ACCESS_KEY: MASKED_KEY_PLACEHOLDER,
      });
      expect(result.azure?.customKeys).toMatchObject({
        AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
      });
      expect(result.custom?.customKeys).toMatchObject({
        CUSTOM_API_KEY: MASKED_KEY_PLACEHOLDER,
      });
    });

    it("masks extra-header values while keeping header keys visible", async () => {
      const result = await makeCaller().getAllForProject({
        projectId: "project_123",
      });

      expect(result.custom?.extraHeaders).toEqual([
        { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
        { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
      ]);
      expect(result.azure?.extraHeaders).toEqual([
        { key: "Ocp-Apim-Subscription-Key", value: MASKED_KEY_PLACEHOLDER },
      ]);
    });

    it("does not include any plaintext secret anywhere in the response", async () => {
      const result = await makeCaller().getAllForProject({
        projectId: "project_123",
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(PLAINTEXT_OPENAI_KEY);
      expect(serialized).not.toContain(PLAINTEXT_AWS_SECRET);
      expect(serialized).not.toContain(PLAINTEXT_AZURE_KEY);
      expect(serialized).not.toContain(PLAINTEXT_HEADER_SECRET);
      expect(serialized).not.toContain("custom-plaintext-key");
      expect(serialized).not.toContain("apim-secret");
    });

    it("keeps non-secret values like base URL and region visible", async () => {
      const result = await makeCaller().getAllForProject({
        projectId: "project_123",
      });

      expect(result.openai?.customKeys).toMatchObject({
        OPENAI_BASE_URL: "https://api.openai.com/v1",
      });
      expect(result.bedrock?.customKeys).toMatchObject({
        AWS_REGION_NAME: "us-east-1",
      });
      expect(result.azure?.customKeys).toMatchObject({
        AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      });
    });
  });

  describe("when a view-only user (no project:update) fetches providers", () => {
    beforeEach(() => {
      mockHasSetupPermission.mockResolvedValue(false);
    });

    it("returns no customKeys at all", async () => {
      const result = await makeCaller().getAllForProject({
        projectId: "project_123",
      });

      expect(result.openai?.customKeys).toBeNull();
      expect(result.custom?.customKeys).toBeNull();
    });

    it("still masks extra-header values", async () => {
      const result = await makeCaller().getAllForProject({
        projectId: "project_123",
      });

      expect(result.custom?.extraHeaders).toEqual([
        { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
        { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
      ]);
      expect(JSON.stringify(result)).not.toContain(PLAINTEXT_HEADER_SECRET);
    });
  });
});
