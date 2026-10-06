import {
  type ApiKey,
  type ApiKeyApi,
  ApiKeyAlreadyRevokedError,
} from "@langwatch/api-key-contract";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import {
  findPersonalWorkspaceInputSchema,
  type OrganizationService,
} from "@langwatch/organization-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The /me ingestion-key service over ApiKeyApi, pinned to main's ingestionKey.service.ts. */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { MemoryIngestionTemplateRepository } from "../../repositories/memory/memory.ingestion-template.repository.ts";
import { PersonalIngestionKeyService } from "../personal-ingestion-key.service.ts";

function apiKey(overrides: Partial<ApiKey>): ApiKey {
  return {
    id: "ak_1",
    name: "Ingestion key (cursor)",
    description: null,
    organizationId: "org_1",
    userId: "user_1",
    createdByUserId: "user_1",
    createdByDeviceLabel: null,
    parentApiKeyId: null,
    lookupId: "lookup_1",
    permissionMode: "restricted",
    expiresAt: null,
    revokedAt: null,
    revocationCause: null,
    lastUsedAt: null,
    ingestSourceType: "cursor",
    ingestionTemplateId: "tpl",
    createdAt: new Date(1_000),
    updatedAt: new Date(1_000),
    grants: [],
    ...overrides,
  };
}

async function setup(
  keys: ApiKey[],
  revoke?: ApiKeyApi["revoke"],
  findById?: ApiKeyApi["findById"],
  record?: AuditLogApi["record"],
) {
  const templates = MemoryIngestionTemplateRepository.create(MemoryGovernanceStore.create());
  const template = await templates.createWithAudit({
    template: {
      slug: "cursor",
      sourceType: "cursor",
      displayName: "Cursor",
      description: null,
      iconAsset: null,
      credentialSchema: null,
      ottlRules: "",
      organizationId: "org_1",
    },
    callerUserId: "seed",
    surface: "hono",
  });
  const live = keys.map((key) =>
    key.ingestionTemplateId === "tpl" ? { ...key, ingestionTemplateId: template.id } : key,
  );
  const created: unknown[] = [];
  const revoked: string[] = [];
  const audited: RecordAuditLogCommand[] = [];
  const service = PersonalIngestionKeyService.create({
    templates,
    auditLog: {
      record:
        record ??
        (async (command) => {
          audited.push(command);
          return { id: `audit_${audited.length}`, occurredAt: 0 };
        }),
    },
    organizations: createApiFixture<OrganizationService>({
      getPersonalWorkspace: async (input) => {
        findPersonalWorkspaceInputSchema.parse(input);
        return {
          team: { id: "team_p", name: "Personal", slug: "personal", createdAtMs: 0 },
          project: { id: "project_p", name: "Personal", slug: "p", apiKey: "k", createdAtMs: 0 },
        };
      },
    }),
    apiKeys: createApiFixture<ApiKeyApi>({
      findIngestionKeysForUser: async () => live,
      findById: findById ?? (async ({ id }) => live.find((key) => key.id === id) ?? null),
      create: async (input) => {
        created.push(input);
        return { token: "ik-lw-0123456789ab", apiKey: apiKey({ id: "ak_new" }) };
      },
      revoke:
        revoke ??
        (async ({ id }) => {
          revoked.push(id);
          return apiKey({ id });
        }),
    }),
  });
  const mint = { userId: "user_1", organizationId: "org_1", sourceType: "cursor" };
  return {
    service,
    created,
    revoked,
    audited,
    mint: { ...mint, ingestionTemplateId: template.id },
  };
}

describe("PersonalIngestionKeyService", () => {
  describe("when a source a template names is installed", () => {
    it("mints a traces:create key on the caller's personal project and answers the token once", async () => {
      const { service, created, mint } = await setup([]);

      await expect(service.mint(mint)).resolves.toEqual({
        token: "ik-lw-0123456789ab",
        apiKeyId: "ak_new",
        prefix: "ik-lw-012345",
        sourceType: "cursor",
      });
      expect(created).toMatchObject([
        {
          userId: "user_1",
          permissions: ["traces:create"],
          bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_p" }],
          parentApiKeyId: null,
        },
      ]);
    });
  });

  describe("when the source is a tool the CLI wraps, or no template names it", () => {
    it("refuses a wrapped tool by code", async () => {
      const { service, mint } = await setup([]);

      await expect(service.mint({ ...mint, sourceType: "claude_code" })).rejects.toMatchObject({
        code: "ingestion_key_source_not_allowed",
      });
    });

    it("refuses a template whose source differs by code", async () => {
      const { service, mint } = await setup([]);

      await expect(service.mint({ ...mint, sourceType: "windsurf" })).rejects.toMatchObject({
        code: "ingestion_key_source_not_allowed",
      });
    });
  });

  describe("when a source is rotated", () => {
    /** @scenario Rotate says how many keys it revokes and which machines hold them */
    it("revokes every live key of that source and template, then mints one", async () => {
      const { service, revoked, mint } = await setup([
        apiKey({ id: "ak_a", createdByDeviceLabel: "laptop" }),
        apiKey({ id: "ak_b", ingestionTemplateId: "other" }),
        apiKey({ id: "ak_c", ingestSourceType: "windsurf" }),
      ]);

      await expect(service.rotate(mint)).resolves.toMatchObject({
        apiKeyId: "ak_new",
        revokedCount: 1,
        revokedDeviceLabels: ["laptop"],
      });
      expect(revoked).toEqual(["ak_a"]);
    });
  });

  describe("when the caller revokes a key", () => {
    /** @scenario Revoking another person's ingestion key answers not found */
    it("refuses another member's key as not found", async () => {
      const { service } = await setup([apiKey({ userId: "user_2" })]);

      await expect(
        service.revoke({ userId: "user_1", organizationId: "org_1", apiKeyId: "ak_1" }),
      ).rejects.toMatchObject({ code: "ingestion_key_not_found" });
    });

    /** @scenario A person revokes one of their own ingestion keys */
    it("revokes the caller's own key with cause user", async () => {
      const causes: unknown[] = [];
      const { service } = await setup([apiKey({})], async (input) => {
        causes.push([input.id, input.cause]);
        return apiKey({ id: input.id });
      });

      await service.revoke({ userId: "user_1", organizationId: "org_1", apiKeyId: "ak_1" });
      expect(causes).toEqual([["ak_1", "user"]]);
    });

    it("succeeds when the key was already revoked underneath", async () => {
      const { service } = await setup([apiKey({})], async ({ id }) => {
        throw new ApiKeyAlreadyRevokedError(id);
      });

      await expect(
        service.revoke({ userId: "user_1", organizationId: "org_1", apiKeyId: "ak_1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a CLI session mints a key for a tool it wraps", () => {
    const session = { userId: "user_1", organizationId: "org_1", sourceType: "claude_code" };
    const login = apiKey({ id: "login_1", ingestSourceType: null, ingestionTemplateId: null });

    it("parents the key to the session's login key and labels it with the device", async () => {
      const { service, created } = await setup([login]);

      await service.mint({ ...session, parentApiKeyId: "login_1", createdByDeviceLabel: "mbp" });
      expect(created).toMatchObject([
        {
          parentApiKeyId: "login_1",
          createdByDeviceLabel: "mbp",
          name: "Ingestion key (claude_code, mbp)",
        },
      ]);
    });

    /** @regression the workspace lookup refused the session's fields and the mint answered 500 */
    it("mints on the personal project with every session field present", async () => {
      const { service, created } = await setup([login]);

      const issued = await service.mint({
        ...session,
        fromCliSession: true,
        parentApiKeyId: "login_1",
        createdByDeviceLabel: "mbp",
      });

      expect(issued.token).toBe("ik-lw-0123456789ab");
      expect(created).toMatchObject([
        { bindings: [{ scopeType: "PROJECT", scopeId: "project_p" }], parentApiKeyId: "login_1" },
      ]);
    });

    it("refuses a session whose login key is revoked as signed out, creating nothing", async () => {
      const { service, created } = await setup([{ ...login, revokedAt: new Date(2_000) }]);

      await expect(service.mint({ ...session, parentApiKeyId: "login_1" })).rejects.toMatchObject({
        code: "ingestion_key_session_revoked",
      });
      expect(created).toEqual([]);
    });

    it("mints an unparented key for a session from before login keys", async () => {
      const { service, created } = await setup([]);

      await service.mint({ ...session, fromCliSession: true });
      expect(created).toMatchObject([{ parentApiKeyId: null }]);
    });

    it("refuses a source no wrapped tool stamps", async () => {
      const { service } = await setup([]);

      await expect(
        service.mint({ ...session, sourceType: "cursor", fromCliSession: true }),
      ).rejects.toMatchObject({ code: "ingestion_key_source_not_allowed" });
    });

    /** @scenario "A mint that races its session's retirement cleans up the key it wrote" */
    it("revokes the key it wrote with cause session when the session died mid-mint", async () => {
      const reads = [login, { ...login, revokedAt: new Date(2_000) }];
      const causes: unknown[] = [];
      const { service } = await setup(
        [login],
        async (input) => {
          causes.push([input.id, input.cause]);
          return apiKey({ id: input.id });
        },
        async () => reads.shift() ?? null,
      );

      await expect(service.mint({ ...session, parentApiKeyId: "login_1" })).rejects.toMatchObject({
        code: "ingestion_key_session_revoked",
      });
      expect(causes).toEqual([["ak_new", "session"]]);
    });
  });

  describe("when a rotation cannot kill every prior key", () => {
    /** @scenario "A rotation that cannot kill every prior key mints nothing" */
    it("attempts every prior key, mints nothing and names the survivors", async () => {
      const attempted: string[] = [];
      const { service, created, mint } = await setup(
        [apiKey({ id: "ak_a", createdByDeviceLabel: "laptop" }), apiKey({ id: "ak_b" })],
        async ({ id }) => {
          attempted.push(id);
          if (id === "ak_a") throw new Error("database unavailable");
          return apiKey({ id });
        },
      );

      await expect(service.rotate(mint)).rejects.toMatchObject({
        code: "ingestion_key_revoke_incomplete",
      });
      expect(attempted).toEqual(["ak_a", "ak_b"]);
      expect(created).toEqual([]);
    });
  });

  describe("when the CLI pins a project", () => {
    /** @scenario Two machines each keep a live key for the same project and tool */
    it("creates a key without revoking any other machine's", async () => {
      const { service, created, revoked } = await setup([apiKey({})]);

      await service.issueForProject({
        callerUserId: "user_1",
        ownerUserId: null,
        organizationId: "org_1",
        projectId: "project_shared",
        sourceType: "claude_code",
        ingestionTemplateId: null,
        createdByDeviceLabel: "desktop",
      });
      expect(revoked).toEqual([]);
      expect(created).toMatchObject([
        { userId: null, name: "Ingestion key (claude_code, desktop)" },
      ]);
    });
  });

  describe("when a door installs, rotates or revokes a key", () => {
    /** @scenario "A door's install, rotate and revoke each record main's audit row" */
    it("records the mint, rotate and revoke rows with the door's surface", async () => {
      const { service, audited, mint } = await setup([apiKey({ id: "ak_a" })]);

      await service.install({ ...mint, surface: "mcp" });
      await service.rotate({ ...mint, surface: "trpc" });
      await service.revoke({ userId: "user_1", organizationId: "org_1", apiKeyId: "ak_a" });
      await Promise.resolve();
      expect(audited).toEqual([
        {
          userId: "user_1",
          organizationId: "org_1",
          action: "ingestionKey.mint",
          args: { apiKeyId: "ak_new", sourceType: "cursor" },
          metadata: { surface: "mcp" },
        },
        {
          userId: "user_1",
          organizationId: "org_1",
          action: "ingestionKey.rotate",
          args: { apiKeyId: "ak_new", sourceType: "cursor", revokedCount: 1 },
          metadata: { surface: "trpc" },
        },
        {
          userId: "user_1",
          organizationId: "org_1",
          action: "ingestionKey.revoke",
          args: { apiKeyId: "ak_a" },
          metadata: { surface: "trpc" },
        },
      ]);
    });

    it("records no audit row for a CLI session's mint", async () => {
      const { service, audited } = await setup([]);

      await service.mint({
        userId: "user_1",
        organizationId: "org_1",
        sourceType: "claude_code",
        fromCliSession: true,
      });
      expect(audited).toEqual([]);
    });
  });

  describe("when the audit write fails", () => {
    const failing: AuditLogApi["record"] = async () => {
      throw new Error("audit store down");
    };

    /** @scenario "A failed mint audit write does not fail the mint" */
    it("still answers the minted token", async () => {
      const { service, mint, created } = await setup([], undefined, undefined, failing);

      await expect(service.install(mint)).resolves.toMatchObject({ apiKeyId: "ak_new" });
      expect(created).toHaveLength(1);
    });

    /** @scenario "A revoke answers only once its audit row is written" */
    it("fails the revoke, whose key is already retired", async () => {
      const { service, revoked } = await setup([apiKey({})], undefined, undefined, failing);

      await expect(
        service.revoke({ userId: "user_1", organizationId: "org_1", apiKeyId: "ak_1" }),
      ).rejects.toThrow("audit store down");
      expect(revoked).toEqual(["ak_1"]);
    });
  });

  describe("when an agent mints a template source the caller already holds a key for", () => {
    /** @scenario An agent minting a template source through MCP adds a key */
    it("adds a traces:create key on the personal workspace and revokes none", async () => {
      const { service, created, revoked, mint } = await setup([
        apiKey({ id: "ak_held", ingestSourceType: "cursor" }),
      ]);

      await expect(service.install(mint)).resolves.toMatchObject({
        apiKeyId: "ak_new",
        sourceType: "cursor",
      });

      expect(created).toMatchObject([
        {
          userId: "user_1",
          permissions: ["traces:create"],
          bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_p" }],
          parentApiKeyId: null,
        },
      ]);
      expect(revoked).toEqual([]);
    });
  });
});
