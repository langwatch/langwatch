import { createApiFixture } from "@langwatch/api-fixture";
import {
  type ApiKey,
  type ApiKeyApi,
  ApiKeyAlreadyRevokedError,
} from "@langwatch/api-key-contract";
import type { RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { MemoryIngestionTemplateRepository } from "../../repositories/memory/memory.ingestion-template.repository.ts";
import {
  type GovernanceMcpServer,
  GovernanceMcpToolsService,
} from "../governance-mcp-tools.service.ts";
import { PersonalIngestionKeyService } from "../personal-ingestion-key.service.ts";

type RegisteredTool = (args: Record<string, unknown>) => Promise<{
  content: { type: "text"; text: string }[];
}>;

function recordingServer() {
  const tools = new Map<string, RegisteredTool>();
  const server: GovernanceMcpServer = {
    tool(name, _description, schema, cb) {
      tools.set(name, (args) => cb(z.object(schema).parse(args)));
      return undefined;
    },
  };
  return { server, tools };
}

function registered({ callerUserId, allowed }: { callerUserId?: string; allowed: boolean }) {
  const asked: string[] = [];
  const service = GovernanceMcpToolsService.create({
    projects: createApiFixture<ProjectApi>({
      getOrganizationId: async () => "org_1",
    }),
    governance: createApiFixture<GovernanceRestApi>({
      templateListForUser: async ({ organizationId }) => {
        asked.push(`list:${organizationId}`);
        return [];
      },
    }),
    permissions: { holdsOrganizationPermission: async () => allowed },
  });
  const { server, tools } = recordingServer();
  service.register({ server, projectId: "project_1", callerUserId });
  return { tools, asked };
}

function ingestionKey(overrides: Partial<ApiKey>): ApiKey {
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
    ingestionTemplateId: null,
    createdAt: new Date(1_000),
    updatedAt: new Date(1_000),
    grants: [],
    ...overrides,
  };
}

/** The tools over the real personal-key service, so the door answers what main's did. */
async function withIngestionKeys({
  keys,
  alreadyRevoked = false,
}: {
  keys: ApiKey[];
  alreadyRevoked?: boolean;
}) {
  const created: unknown[] = [];
  const revoked: unknown[] = [];
  const audited: RecordAuditLogCommand[] = [];
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
  const ingestionKeys = PersonalIngestionKeyService.create({
    auditLog: {
      record: async (command) => {
        audited.push(command);
        return { id: "audit_1", occurredAt: 0 };
      },
    },
    templates,
    organizations: createApiFixture<OrganizationService>({
      getPersonalWorkspace: async () => ({
        team: { id: "team_p", name: "Personal", slug: "personal", createdAtMs: 0 },
        project: { id: "project_p", name: "Personal", slug: "p", apiKey: "k", createdAtMs: 0 },
      }),
    }),
    apiKeys: createApiFixture<ApiKeyApi>({
      findById: async ({ id }) => keys.find((key) => key.id === id) ?? null,
      create: async (input) => {
        created.push(input);
        return { token: "ik-lw-0123456789ab", apiKey: ingestionKey({ id: "ak_new" }) };
      },
      revoke: async ({ id, cause }) => {
        if (alreadyRevoked) throw new ApiKeyAlreadyRevokedError(id);
        revoked.push([id, cause]);
        return ingestionKey({ id });
      },
    }),
  });
  const service = GovernanceMcpToolsService.create({
    projects: createApiFixture<ProjectApi>({
      getOrganizationId: async () => "org_1",
    }),
    governance: createApiFixture<GovernanceRestApi>({
      ingestionKeyInstall: (input) => ingestionKeys.install(input),
      ingestionKeyRevoke: (input) => ingestionKeys.revoke(input),
    }),
    permissions: { holdsOrganizationPermission: async () => true },
  });
  const { server, tools } = recordingServer();
  service.register({ server, projectId: "project_1", callerUserId: "user_1" });
  return { tools, created, revoked, audited, templateId: template.id };
}

describe("GovernanceMcpToolsService", () => {
  describe("when a session registers the governance tools", () => {
    it("installs every governance tool", () => {
      const { tools } = registered({ allowed: true });
      expect([...tools.keys()]).toHaveLength(10);
    });
  });

  describe("when a project-apiKey session reads the template list", () => {
    it("answers the organization's templates without a user", async () => {
      const { tools, asked } = registered({ allowed: false });
      const result = await tools.get("governance_ingestion_templates_list")!({});
      expect(asked).toEqual(["list:org_1"]);
      expect(result.content[0]!.text).toBe("[]");
    });
  });

  describe("when a project-apiKey session tries a write", () => {
    it("refuses with the OAuth requirement", async () => {
      const { tools } = registered({ allowed: true });
      const result = await tools.get("governance_ingestion_templates_archive")!({ id: "t1" });
      expect(result.content[0]!.text).toMatch(/^AUTH_REQUIRED: /);
    });
  });

  describe("when a person's MCP session calls a template tool", () => {
    /** @scenario A person's MCP session is refused the organization's ingestion templates */
    it("refuses the read by code, even with the permission, and reads nothing", async () => {
      const { tools, asked } = registered({ callerUserId: "user_1", allowed: true });

      await expect(tools.get("governance_ingestion_templates_list")!({})).rejects.toMatchObject({
        code: "api_key_scope_violation",
      });
      expect(asked).toEqual([]);
    });

    it("refuses an OTTL rules write by code", async () => {
      const { tools } = registered({ callerUserId: "user_1", allowed: true });

      await expect(
        tools.get("governance_ingestion_templates_update_ottl_rules")!({
          id: "t1",
          ottl_rules: "",
        }),
      ).rejects.toMatchObject({ code: "api_key_scope_violation" });
    });
  });

  describe("when an agent mints a key for a tool the CLI wraps", () => {
    /** @scenario "The MCP mint refuses a tool the CLI wraps" */
    it("refuses by code and creates no key", async () => {
      const { tools, created } = await withIngestionKeys({ keys: [] });

      await expect(
        tools.get("governance_ingestion_keys_mint")!({ source_type: "claude_code" }),
      ).rejects.toMatchObject({ code: "ingestion_key_source_not_allowed" });
      expect(created).toEqual([]);
    });
  });

  describe("when an agent revokes one of the caller's keys", () => {
    /** @scenario "An agent revokes one of the caller's own keys through the MCP tool" */
    it("revokes it with cause user and answers main's line", async () => {
      const { tools, revoked } = await withIngestionKeys({ keys: [ingestionKey({})] });

      const result = await tools.get("governance_ingestion_keys_revoke")!({ api_key_id: "ak_1" });
      expect(revoked).toEqual([["ak_1", "user"]]);
      expect(result.content[0]!.text).toBe("revoked ak_1");
    });

    /** @scenario "The MCP door's mint and revoke audit rows carry the mcp surface" */
    it("records the mint and revoke rows with the mcp surface", async () => {
      const { tools, audited, templateId } = await withIngestionKeys({ keys: [ingestionKey({})] });

      await tools.get("governance_ingestion_keys_mint")!({
        source_type: "cursor",
        template_id: templateId,
      });
      await tools.get("governance_ingestion_keys_revoke")!({ api_key_id: "ak_1" });
      expect(audited).toMatchObject([
        { action: "ingestionKey.mint", metadata: { surface: "mcp" } },
        { action: "ingestionKey.revoke", metadata: { surface: "mcp" } },
      ]);
    });

    /** @scenario "Revoking an already revoked key through the MCP tool is not an error" */
    it("answers revoked again when the key is already revoked", async () => {
      const { tools } = await withIngestionKeys({ keys: [ingestionKey({})], alreadyRevoked: true });

      const result = await tools.get("governance_ingestion_keys_revoke")!({ api_key_id: "ak_1" });
      expect(result.content[0]!.text).toBe("revoked ak_1");
    });

    /** @scenario "Another person's key answers not found through the MCP tool" */
    it("refuses another person's key as not found and revokes nothing", async () => {
      const { tools, revoked } = await withIngestionKeys({
        keys: [ingestionKey({ userId: "user_2" })],
      });

      await expect(
        tools.get("governance_ingestion_keys_revoke")!({ api_key_id: "ak_1" }),
      ).rejects.toMatchObject({ code: "ingestion_key_not_found" });
      expect(revoked).toEqual([]);
    });
  });
});
