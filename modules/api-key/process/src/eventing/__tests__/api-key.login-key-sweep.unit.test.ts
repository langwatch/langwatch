/**
 * The hourly CLI login-key sweep as the installed module runs it: the
 * module's own revoke over its own repository, nothing stubbed between them.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ApiKeyModule } from "../../app/api-key.app.ts";
import type { ApiKeyRow } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { apiKeyEventing } from "../api-key.pipeline.ts";
import { CLI_LOGIN_KEY_REAP_PROCESS_NAME } from "../cli-login-key-reap.process.ts";

const ORG_ID = "org_1";
const HOUR_MS = 60 * 60 * 1000;

function keyRow(overrides: Partial<ApiKeyRow> & Pick<ApiKeyRow, "id" | "name">): ApiKeyRow {
  const now = Date.now();
  return {
    description: null,
    organizationId: ORG_ID,
    userId: "user_1",
    createdByUserId: "user_1",
    createdByDeviceLabel: "laptop",
    parentApiKeyId: null,
    permissionMode: "restricted",
    expiresAt: null,
    revokedAt: null,
    revocationCause: null,
    lookupId: `lookup_${overrides.id}`,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date(now - 24 * HOUR_MS),
    updatedAt: new Date(now),
    hashedSecret: "hashed",
    ...overrides,
  };
}

async function sweepOver(rows: ApiKeyRow[]) {
  const database = MemoryApiKeyDatabase.create();
  for (const row of rows) database.replaceKey(row);
  const apiKeys = MemoryApiKeyRepository.create({ memory: database });
  const authorization = createApiFixture<AuthzApi>({
    listApiKeyBindings: vi.fn(async () => []),
    revokeBindingsWhere: vi.fn(async () => 0),
  });
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
  );
  const app = await ApiKeyModule.create({
    repositories: { apiKeys, answers: MemoryApiKeyAnswerCacheRepository.create() },
    dependencies: {
      authorization,
      organizations: createApiFixture<OrganizationApi>({}),
      projects: createApiFixture<ProjectApi>({}),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
  });
  const definition = apiKeyEventing.build({
    participation: "consume",
    repositories: { apiKeys, answers: MemoryApiKeyAnswerCacheRepository.create() },
    app,
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const reap = definition.processManagers.get(CLI_LOGIN_KEY_REAP_PROCESS_NAME)!.config.intents!
    .reap!.run;
  const row = (id: string) => database.keys().find((key) => key.id === id);

  return { reap: () => reap({ scheduledFor: 0 } as never, {} as never), row };
}

describe("given a CLI login key whose expiry passed and one whose expiry has not", () => {
  describe("when the hourly sweep runs", () => {
    /** @scenario The reaper retires login keys whose session window ran out */
    it("revokes only the elapsed key with cause expired, and the ingest keys under it", async () => {
      const { reap, row } = await sweepOver([
        keyRow({
          id: "ak_elapsed",
          name: "CLI login - laptop",
          expiresAt: new Date(Date.now() - HOUR_MS),
        }),
        keyRow({
          id: "ak_live",
          name: "CLI login - desktop",
          createdByDeviceLabel: "desktop",
          expiresAt: new Date(Date.now() + HOUR_MS),
        }),
        keyRow({
          id: "ak_ingest_under_elapsed",
          name: "Ingestion key",
          parentApiKeyId: "ak_elapsed",
        }),
        keyRow({
          id: "ak_ingest_under_live",
          name: "Ingestion key",
          parentApiKeyId: "ak_live",
        }),
      ]);

      await reap();

      expect(row("ak_elapsed")?.revokedAt).not.toBeNull();
      expect(row("ak_elapsed")?.revocationCause).toBe("expired");
      expect(row("ak_ingest_under_elapsed")?.revokedAt).not.toBeNull();
      expect(row("ak_live")?.revokedAt).toBeNull();
      expect(row("ak_ingest_under_live")?.revokedAt).toBeNull();
    });
  });
});
