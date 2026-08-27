/** @vitest-environment node */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { prisma } from "../../db";
import { readCustomKeys } from "../customKeys";

wireDefaultTestApp();

const canUseDatabase = Boolean(process.env.DATABASE_URL);
const hasCredentialsSecret = Boolean(process.env.CREDENTIALS_SECRET);

describe.skipIf(!canUseDatabase || !hasCredentialsSecret)(
  "model provider credential preservation (real DB)",
  () => {
    const namespace = `model-provider-credentials-${nanoid(8)}`;
    const storedKey = `sk-stored-${namespace}`;

    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let adminUserId: string;

    const service = () => getApp().modelProviders;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: {
          name: `Model Provider Credentials ${namespace}`,
          slug: `--${namespace}`,
        },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: {
          name: `Model Provider Credentials ${namespace}`,
          slug: `--${namespace}`,
          organizationId,
        },
      });
      teamId = team.id;

      const project = await prisma.project.create({
        data: {
          name: `Model Provider Credentials ${namespace}`,
          slug: `--${namespace}`,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `model-provider-credentials-${namespace}`,
        },
      });
      projectId = project.id;

      const admin = await prisma.user.create({
        data: {
          name: "Model Provider Credentials Admin",
          email: `model-provider-credentials-${namespace}@example.com`,
        },
      });
      adminUserId = admin.id;
      await prisma.organizationUser.create({
        data: { userId: adminUserId, organizationId, role: OrganizationUserRole.ADMIN },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: adminUserId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["modelProvider", { organizationId }],
        ["roleBinding", { organizationId }],
        ["organizationUser", { organizationId }],
        ["project", { id: projectId }],
        ["team", { id: teamId }],
        ["organization", { id: organizationId }],
        ["user", { id: adminUserId }],
      ]);
    });

    async function createProvider(provider: string, customKeys: Record<string, unknown>) {
      return service().upsert({
        projectId,
        actorId: adminUserId,
        provider,
        enabled: true,
        customKeys,
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });
    }

    async function updateProvider(input: {
      id: string;
      provider: string;
      customKeys: Record<string, unknown>;
    }) {
      return service().upsert({
        ...input,
        projectId,
        actorId: adminUserId,
        enabled: true,
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });
    }

    async function readKeys(id: string): Promise<Record<string, unknown>> {
      const row = await prisma.modelProvider.findUnique({
        where: { id },
        select: { customKeys: true },
      });
      return readCustomKeys(row?.customKeys).keys;
    }

    it("keeps a masked API key while saving a changed endpoint", async () => {
      const provider = await createProvider("openai", {
        OPENAI_API_KEY: storedKey,
      });

      await updateProvider({
        id: provider.id,
        provider: "openai",
        customKeys: {
          OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          OPENAI_BASE_URL: "https://openai.internal/v1",
        },
      });

      await expect(readKeys(provider.id)).resolves.toEqual({
        OPENAI_API_KEY: storedKey,
        OPENAI_BASE_URL: "https://openai.internal/v1",
      });
    });

    it("allows an explicitly cleared credential", async () => {
      const provider = await createProvider("anthropic", {
        ANTHROPIC_API_KEY: storedKey,
      });

      await updateProvider({
        id: provider.id,
        provider: "anthropic",
        customKeys: {
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_BASE_URL: "https://anthropic.internal/v1",
        },
      });

      await expect(readKeys(provider.id)).resolves.toEqual({
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_BASE_URL: "https://anthropic.internal/v1",
      });
    });

    it.each([
      {
        provider: "azure",
        stored: {
          AZURE_OPENAI_API_KEY: storedKey,
          AZURE_OPENAI_ENDPOINT: "https://azure.example.test",
        },
        incoming: { "api-key": "header-secret" },
      },
      {
        provider: "azure",
        stored: {
          AZURE_OPENAI_API_KEY: storedKey,
          AZURE_OPENAI_ENDPOINT: "https://azure.example.test",
        },
        incoming: {},
      },
      {
        provider: "custom",
        stored: {
          CUSTOM_API_KEY: storedKey,
          CUSTOM_BASE_URL: "https://custom.example.test/v1",
        },
        incoming: { "x-tenant": "acme" },
      },
      {
        provider: "azure_safety",
        stored: {
          AZURE_CONTENT_SAFETY_ENDPOINT: "https://safety.example.test",
          AZURE_CONTENT_SAFETY_KEY: storedKey,
        },
        incoming: { "x-tenant": "acme" },
      },
    ])(
      "does not replace $provider credentials when the update has no credential fields",
      async ({ provider, stored, incoming }) => {
        const row = await createProvider(provider, stored);

        await expect(
          updateProvider({ id: row.id, provider, customKeys: incoming }),
        ).rejects.toBeDefined();
        await expect(readKeys(row.id)).resolves.toEqual(stored);
      },
    );

    it("accepts Azure credential fields and preserves a masked API key", async () => {
      const provider = await createProvider("azure", {
        AZURE_OPENAI_API_KEY: storedKey,
        AZURE_OPENAI_ENDPOINT: "https://azure.example.test",
      });

      await updateProvider({
        id: provider.id,
        provider: "azure",
        customKeys: {
          AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          AZURE_OPENAI_ENDPOINT: "https://azure-next.example.test",
        },
      });

      await expect(readKeys(provider.id)).resolves.toEqual({
        AZURE_OPENAI_API_KEY: storedKey,
        AZURE_OPENAI_ENDPOINT: "https://azure-next.example.test",
      });
    });

    it("accepts intentional empty Azure credentials and a header-only first save", async () => {
      const configured = await createProvider("azure", {
        AZURE_OPENAI_API_KEY: storedKey,
        AZURE_OPENAI_ENDPOINT: "https://azure.example.test",
      });
      const empty = await createProvider("azure", { AZURE_OPENAI_API_KEY: "" });

      await updateProvider({
        id: configured.id,
        provider: "azure",
        customKeys: { AZURE_OPENAI_API_KEY: "", AZURE_OPENAI_ENDPOINT: "" },
      });
      await updateProvider({
        id: empty.id,
        provider: "azure",
        customKeys: { "api-key": "header-secret" },
      });

      await expect(readKeys(configured.id)).resolves.toEqual({
        AZURE_OPENAI_API_KEY: "",
        AZURE_OPENAI_ENDPOINT: "",
      });
      await expect(readKeys(empty.id)).resolves.toEqual({ "api-key": "header-secret" });
    });

    it("keeps an omitted Azure secret and switches to gateway fields", async () => {
      const provider = await createProvider("azure", {
        AZURE_OPENAI_API_KEY: storedKey,
        AZURE_OPENAI_ENDPOINT: "https://azure.example.test",
      });

      await updateProvider({
        id: provider.id,
        provider: "azure",
        customKeys: { AZURE_OPENAI_ENDPOINT: "https://azure-next.example.test" },
      });
      await expect(readKeys(provider.id)).resolves.toEqual({
        AZURE_OPENAI_API_KEY: storedKey,
        AZURE_OPENAI_ENDPOINT: "https://azure-next.example.test",
      });

      await updateProvider({
        id: provider.id,
        provider: "azure",
        customKeys: {
          AZURE_API_GATEWAY_BASE_URL: "https://gateway.example.test",
          AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
        },
      });
      await expect(readKeys(provider.id)).resolves.toEqual({
        AZURE_API_GATEWAY_BASE_URL: "https://gateway.example.test",
        AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
        AZURE_OPENAI_API_KEY: storedKey,
      });
    });

    it.each([
      {},
      { AZURE_OPENAI_API_KEY: "", AZURE_OPENAI_ENDPOINT: "" },
      {
        AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
        AZURE_OPENAI_ENDPOINT: "",
      },
    ])(
      "refuses unreadable credentials without a usable replacement",
      async (customKeys) => {
        const provider = await createProvider("azure", {
          AZURE_OPENAI_API_KEY: storedKey,
          AZURE_OPENAI_ENDPOINT: "https://azure.example.test",
        });
        const ciphertext = `unreadable-${namespace}-${provider.id}`;
        await prisma.modelProvider.update({
          where: { id: provider.id },
          data: { customKeys: ciphertext },
        });

        await expect(
          updateProvider({ id: provider.id, provider: "azure", customKeys }),
        ).rejects.toMatchObject({ code: "model_provider_credentials_unreadable" });
        await expect(
          prisma.modelProvider.findUnique({
            where: { id: provider.id },
            select: { customKeys: true },
          }),
        ).resolves.toMatchObject({ customKeys: ciphertext });
      },
    );

    it("allows a usable replacement for unreadable credentials", async () => {
      const provider = await createProvider("azure", {
        AZURE_OPENAI_API_KEY: storedKey,
        AZURE_OPENAI_ENDPOINT: "https://azure.example.test",
      });
      await prisma.modelProvider.update({
        where: { id: provider.id },
        data: { customKeys: `unreadable-${namespace}-${provider.id}` },
      });

      await updateProvider({
        id: provider.id,
        provider: "azure",
        customKeys: {
          AZURE_OPENAI_API_KEY: "sk-fresh",
          AZURE_OPENAI_ENDPOINT: "https://azure-recovered.example.test",
        },
      });

      await expect(readKeys(provider.id)).resolves.toEqual({
        AZURE_OPENAI_API_KEY: "sk-fresh",
        AZURE_OPENAI_ENDPOINT: "https://azure-recovered.example.test",
      });
    });
  },
);
