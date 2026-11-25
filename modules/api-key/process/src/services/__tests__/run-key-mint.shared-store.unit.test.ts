/**
 * A run's key is minted once across every api server and shared sealed in one Redis: two servers
 * minting for one run end with one key and one token, and a retry on any server reuses that key.
 *
 * @see modules/api-key/specs/api-key.feature
 */
import { RUN_KEY_LIFETIME_MS } from "@langwatch/api-key-contract";
import {
  AuthzGrantNotConfirmedError,
  authzEffectivePermissionsOutputSchema,
  type AuthzApi,
} from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { projectWithTeamSchema, type ProjectApi } from "@langwatch/project-contract";
import { RedisSharedCredentialStore } from "@langwatch/redis-client/shared-credential";
import { type SharedCredentialCipher } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";
import { ApiKeyService } from "../api-key.service.ts";
import { RunKeyMintService } from "../run-key-mint.service.ts";

const projectId = "project-1";
const input = { userId: "user-1", projectId, permissions: ["traces:create"] };

const project = projectWithTeamSchema.parse({
  id: projectId,
  name: "Project",
  slug: "project",
  apiKey: "sk-lw-legacy",
  lwqlKey: "lwql",
  teamId: "team-1",
  language: "typescript",
  framework: "langchain",
  kind: "application",
  firstMessage: false,
  integrated: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: {},
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
  team: {
    id: "team-1",
    name: "Team",
    slug: "team",
    organizationId: "org-1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  },
});

/** A reversible stand-in for the process's cipher; it refuses anything it did not seal. */
const cipher: SharedCredentialCipher = {
  encrypt: (plaintext) => `sealed:${plaintext}`,
  decrypt: (ciphertext) => {
    if (!ciphertext.startsWith("sealed:")) throw new Error("not sealed by this cipher");
    return ciphertext.slice("sealed:".length);
  },
};

/** One Redis both servers reach; a claim is released only while its own token still holds it. */
function sharedRedis() {
  const store = memoryRedisStore();
  const keyspace = memoryRedisDouble({ store });
  const releaseIfOwned = async (_script: unknown, _keys: unknown, key: unknown, token: unknown) =>
    (await keyspace.get(String(key))) === token ? keyspace.del(String(key)) : 0;
  return () => memoryRedisDouble({ store, script: { eval: releaseIfOwned } });
}

/** Two api servers over one database, one Redis and one grants ledger whose fold may lag. */
function createServers() {
  const database = MemoryApiKeyDatabase.create();
  const redis = sharedRedis();
  const fold = { lags: false };
  const confirmed = async () => {
    if (fold.lags) throw new AuthzGrantNotConfirmedError();
  };
  const authz = createApiFixture<AuthzApi>({
    getScope: vi.fn().mockResolvedValue({
      type: "project",
      id: projectId,
      teamId: "team-1",
      organizationId: "org-1",
    }),
    effectivePermissions: vi
      .fn()
      .mockResolvedValue(authzEffectivePermissionsOutputSchema.parse(["traces:create"])),
    can: vi.fn().mockResolvedValue(true),
    findPermissionsBeyondCaller: vi.fn().mockResolvedValue([]),
    hasPermission: vi.fn().mockResolvedValue(true),
    listApiKeyBindings: vi.fn().mockResolvedValue([]),
    listUserBindings: vi.fn().mockResolvedValue([]),
    listScopeBindings: vi.fn().mockResolvedValue([]),
    listOrganizationBindings: vi.fn().mockResolvedValue([]),
    listUserCreatedRoles: vi.fn().mockResolvedValue([]),
  });
  const grants = createApiFixture<AuthzApi>({
    defineRole: vi.fn(confirmed),
    attachBindings: vi.fn(async () => {
      await confirmed();
      return { attached: [], duplicates: [] };
    }),
    revokeBindingsWhere: vi.fn().mockResolvedValue(0),
    deleteRole: vi.fn().mockResolvedValue(undefined),
  });
  const server = () => {
    const apiKeys = ApiKeyService.create({
      repository: MemoryApiKeyRepository.create({ memory: database }),
      answers: MemoryApiKeyAnswerCacheRepository.create(),
      authz,
      grants,
      organizations: createApiFixture<OrganizationApi>({
        getTeam: vi.fn().mockResolvedValue({ id: "team-1", name: "Team" }),
      }),
      projects: createApiFixture<ProjectApi>({
        getWithTeam: vi.fn().mockResolvedValue(project),
        findWithTeam: vi.fn().mockResolvedValue(project),
        findPersonalWorkspaceOwner: vi.fn().mockResolvedValue(null),
      }),
      bindingIds: { generateBindingId: () => "binding-1" },
      legacyGrants: { mint: vi.fn() },
      tokens: ApiKeyTokenService.create("test-pepper"),
    });

    const held = RedisSharedCredentialStore.create({
      redis: redis(),
      cipher,
      prefix: "api-key:run-key:",
    });

    return { apiKeys, runKeys: RunKeyMintService.create({ apiKeys, authz, held }) };
  };

  return { database, fold, first: server(), second: server() };
}

describe("RunKeyMintService over one store shared by two servers", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "Two api servers minting the same run key at once get one key and the same token" */
  it("hands two servers minting one run's key at once the same token for one key", async () => {
    const { database, first, second } = createServers();

    const [one, other] = await Promise.all([
      first.runKeys.mintRunKey(input),
      second.runKeys.mintRunKey(input),
    ]);

    expect(other).toBe(one);
    expect(database.keys()).toHaveLength(1);
    expect((await second.apiKeys.findVerifiedToken({ token: one }))?.id).toBe(
      database.keys()[0]?.id,
    );
  });

  /** @scenario "Two first attempts on two servers for one run end with one key" */
  it("ends two simultaneous first attempts with one key, which a retry then activates", async () => {
    const { database, fold, first, second } = createServers();
    fold.lags = true;

    const results = await Promise.allSettled([
      first.runKeys.mintRunKey(input),
      second.runKeys.mintRunKey(input),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({
        status: "rejected",
        reason: { code: "authz_grant_not_confirmed", retryable: true },
      });
    }
    expect(database.keys()).toHaveLength(1);
    const [key] = database.keys();

    fold.lags = false;
    const token = await second.runKeys.mintRunKey(input);

    expect(database.keys()).toHaveLength(1);
    expect((await first.apiKeys.findVerifiedToken({ token }))?.id).toBe(key?.id);
  });

  /** @scenario "A server minting after another activated the run's key gets that key" */
  it("hands a later server the key another server already activated", async () => {
    const { database, first, second } = createServers();
    const token = await first.runKeys.mintRunKey(input);

    expect(await second.runKeys.mintRunKey(input)).toBe(token);
    expect(database.keys()).toHaveLength(1);
  });

  /** @scenario "A retried run key mint on another server succeeds with the first attempt's key" */
  it("hands a retry on the other server the first attempt's token once its grants fold", async () => {
    const { database, fold, first, second } = createServers();
    fold.lags = true;
    await expect(first.runKeys.mintRunKey(input)).rejects.toMatchObject({
      code: "authz_grant_not_confirmed",
      retryable: true,
    });
    const [pending] = database.keys();

    fold.lags = false;
    const token = await second.runKeys.mintRunKey(input);

    expect(database.keys()).toHaveLength(1);
    expect((await second.apiKeys.findVerifiedToken({ token }))?.id).toBe(pending?.id);
    expect(await first.runKeys.mintRunKey(input)).toBe(token);
  });

  /** @scenario "A retried run key mint waits on the key the first attempt wrote" */
  it("writes no second key while the fold still lags, whichever server the retry reaches", async () => {
    const { database, fold, first, second } = createServers();
    fold.lags = true;

    for (const server of [first, second, first]) {
      await expect(server.runKeys.mintRunKey(input)).rejects.toMatchObject({
        code: "authz_grant_not_confirmed",
      });
    }

    expect(database.keys()).toHaveLength(1);
    expect(database.keys()[0]?.revokedAt).not.toBeNull();
  });

  /** @scenario "A pending run key past its usefulness is replaced, never activated" */
  it("replaces a pending key without the life the run needs, and never activates the old row", async () => {
    const { database, fold, first, second } = createServers();
    fold.lags = true;
    await expect(first.runKeys.mintRunKey(input)).rejects.toMatchObject({
      code: "authz_grant_not_confirmed",
    });
    const [stale] = database.keys();

    vi.setSystemTime(new Date(Date.now() + RUN_KEY_LIFETIME_MS - 60_000));
    fold.lags = false;
    const token = await second.runKeys.mintRunKey(input);

    const live = database.keys().filter((key) => key.revokedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0]?.id).not.toBe(stale?.id);
    expect((await second.apiKeys.findVerifiedToken({ token }))?.id).toBe(live[0]?.id);
  });
});
