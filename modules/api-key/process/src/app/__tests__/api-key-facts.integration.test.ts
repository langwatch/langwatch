/**
 * Key facts for staff ops functions (ADR-202): every key of one organization as ids, kinds,
 * reach and times, read from Postgres; never a name, token, lookup id or hash.
 * @vitest-environment node
 * @see modules/api-key/specs/api-key-facts.feature
 */
import { randomUUID } from "node:crypto";

import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  STAFF_READ_KEY_NAME,
  WORKFLOW_RUN_API_KEY_NAME,
  type ApiKeyFacts,
} from "@langwatch/api-key-contract";
import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryApiKeyChannels } from "../../channels/memory/memory.api-key.channels.ts";
import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemorySigningKeyUsageRepository } from "../../repositories/memory/memory.signing-key-usage.repository.ts";
import { MemorySigningKeyRepository } from "../../repositories/memory/memory.signing-key.repository.ts";
import { PrismaApiKeyRepository } from "../../repositories/prisma/prisma.api-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const HOUR_MS = 60 * 60 * 1000;

describe.skipIf(!DB_URL)("api key facts on Postgres", () => {
  const ns = `key-facts-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:api-key:test:api-key-facts"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const projectId = `${ns}-project`;
  const customRoleId = `${ns}-role`;
  const organizationIds: string[] = [];
  const keyIds: Record<string, string> = {};
  const lookupIds: string[] = [];
  let organizationId: string;
  let facts: ApiKeyFacts[];

  const createKey = async (
    label: string,
    data: {
      organizationId: string;
      name: string;
      userId?: string | null;
      isSystemManaged?: boolean;
      ingestSourceType?: string;
      createdByDeviceLabel?: string;
      revokedAt?: Date;
      lastUsedAt?: Date;
      expiresAt?: Date;
      createdAt?: Date;
    },
  ) => {
    const lookupId = `${ns}-${label}-${randomUUID().slice(0, 8)}`;
    lookupIds.push(lookupId);
    const row = await prisma.apiKey.create({
      data: { ...data, lookupId, hashedSecret: `hash-${lookupId}`, permissionMode: "all" },
    });
    keyIds[label] = row.id;
  };

  beforeAll(async () => {
    for (const suffix of ["", "-other"]) {
      const organization = await prisma.organization.create({
        data: { name: "ACME", slug: `--${ns}${suffix}` },
      });
      organizationIds.push(organization.id);
    }
    const [own, other] = organizationIds;
    organizationId = own!;
    const now = Date.now();

    await createKey("service", {
      organizationId,
      name: "ACME production key",
      lastUsedAt: new Date(now - HOUR_MS),
      createdAt: new Date(now - 5 * HOUR_MS),
    });
    await createKey("ingestion", {
      organizationId,
      name: "Claude Code ingest",
      ingestSourceType: "claude_code",
      createdAt: new Date(now - 4 * HOUR_MS),
    });
    await createKey("cli", {
      organizationId,
      name: `${CLI_LOGIN_KEY_NAME_PREFIX}ACME laptop`,
      createdByDeviceLabel: "ACME laptop",
      createdAt: new Date(now - 3 * HOUR_MS),
    });
    await createKey("staff", {
      organizationId,
      name: STAFF_READ_KEY_NAME,
      isSystemManaged: true,
      expiresAt: new Date(now + HOUR_MS),
      createdAt: new Date(now - 2 * HOUR_MS),
    });
    await createKey("customerWorkflowName", {
      organizationId,
      name: WORKFLOW_RUN_API_KEY_NAME,
      createdAt: new Date(now - HOUR_MS),
    });
    await createKey("revokedRun", {
      organizationId,
      name: WORKFLOW_RUN_API_KEY_NAME,
      isSystemManaged: true,
      revokedAt: new Date(now - HOUR_MS),
      createdAt: new Date(now),
    });
    await createKey("otherOrganization", { organizationId: other!, name: "Other org key" });

    const authorization = createApiFixture<AuthzApi>({
      listApiKeyBindings: async ({ apiKeyIds }) =>
        apiKeyIds.flatMap((apiKeyId): AuthzAccessBinding[] =>
          apiKeyId === keyIds.ingestion
            ? [
                {
                  id: `grant-${apiKeyId}`,
                  organizationId,
                  userId: null,
                  groupId: null,
                  apiKeyId,
                  role: "CUSTOM",
                  customRoleId,
                  scopeType: "PROJECT",
                  scopeId: projectId,
                  createdAt: new Date(0),
                  user: null,
                  group: null,
                  apiKey: null,
                  customRole: null,
                },
              ]
            : [
                {
                  id: `grant-${apiKeyId}`,
                  organizationId,
                  userId: null,
                  groupId: null,
                  apiKeyId,
                  role: "ADMIN",
                  customRoleId: null,
                  scopeType: "ORGANIZATION",
                  scopeId: organizationId,
                  createdAt: new Date(0),
                  user: null,
                  group: null,
                  apiKey: null,
                  customRole: null,
                },
              ],
        ),
      findRolePermissions: async ({ roleIds }) =>
        roleIds.map((id) => ({ id, name: "Ingest only", permissions: ["traces:create"] })),
    });
    const resolver = SecretsResolver.over(
      SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
    );
    const app = await ApiKeyModule.create({
      repositories: {
        apiKeys: PrismaApiKeyRepository.create({ prisma }),
        answers: MemoryApiKeyAnswerCacheRepository.create(),
        sandboxKeys: MemorySharedCredentialStore.create(),
        runKeys: MemorySharedCredentialStore.create(),
        signingKeys: MemorySigningKeyRepository.create(),
        signingKeyUsage: MemorySigningKeyUsageRepository.create(),
      },
      dependencies: {
        authorization,
        organizations: createApiFixture<OrganizationApi>({}),
        projects: createApiFixture<ProjectApi>({}),
      },
      secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
      channels: MemoryApiKeyChannels.create(),
      config: { docsOrigins: void 0, isSaas: true, publicBaseUrl: "https://app.langwatch.ai" },
    });
    facts = await app.findKeyFactsForOrganization({ organizationId });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  const factOf = (label: string) => facts.find((fact) => fact.id === keyIds[label]);

  /** @scenario "Every key of the organization is answered with its kind" */
  it("answers every key once with its kind, live keys first", () => {
    expect(facts.map((fact) => fact.id)).toEqual([
      keyIds.customerWorkflowName,
      keyIds.staff,
      keyIds.cli,
      keyIds.ingestion,
      keyIds.service,
      keyIds.revokedRun,
    ]);
    expect(facts.map((fact) => fact.kind)).toEqual([
      "service",
      "staff_read",
      "cli_login",
      "ingestion",
      "service",
      "workflow_run",
    ]);
    expect(factOf("revokedRun")?.revokedAt).toBeTypeOf("number");
    expect(factOf("staff")?.expiresAt).toBeTypeOf("number");
    expect(factOf("service")?.lastUsedAt).toBeTypeOf("number");
  });

  /** @scenario "A customer key under a system name keeps its customer kind" */
  it("reads a customer key under a system name as a service key", () => {
    expect(factOf("customerWorkflowName")?.kind).toBe("service");
  });

  /** @scenario "Key facts never carry a name or secret" */
  it("carries no name, lookup id or hash", () => {
    const answered = JSON.stringify(facts);
    for (const text of ["ACME production key", "ACME laptop", STAFF_READ_KEY_NAME, "hash-"]) {
      expect(answered).not.toContain(text);
    }
    for (const lookupId of lookupIds) expect(answered).not.toContain(lookupId);
    for (const fact of facts) {
      expect(Object.keys(fact).toSorted()).toEqual([
        "createdAt",
        "expiresAt",
        "id",
        "kind",
        "lastUsedAt",
        "permissions",
        "projectId",
        "revokedAt",
      ]);
    }
  });

  /** @scenario "A key bound to one project names it, with its permissions" */
  it("names the one project and the custom role's permissions", () => {
    expect(factOf("ingestion")).toMatchObject({ projectId, permissions: ["traces:create"] });
    expect(factOf("service")).toMatchObject({ projectId: null, permissions: ["role:admin"] });
  });

  /** @scenario "Another organization's keys are never answered" */
  it("never answers another organization's keys", () => {
    expect(facts.map((fact) => fact.id)).not.toContain(keyIds.otherOrganization);
  });
});
