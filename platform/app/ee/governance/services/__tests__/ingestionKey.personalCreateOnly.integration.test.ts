// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * The CLI is not the only door to a personal ingest key: the /me Trace Ingest
 * tile connects a source, and an agent mints one through MCP. Neither has a
 * session to parent a key to, so both add a key for a source a published
 * template names and refuse a tool the CLI wraps. The tile's rotate is the
 * one verb that kills every machine's key for a source, and it says how many.
 *
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { registerGovernanceMcpTools } from "~/mcp/governance-tools";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

import { IngestionKeyService } from "../ingestionKey.service";

wireDefaultTestApp();

const suffix = nanoid(8);
const ORG_ID = `org-ikc-${suffix}`;
const USER_ID = `usr-ikc-${suffix}`;
const TEAM_ID = `team-ikc-${suffix}`;
const PROJECT_ID = `prj-ikc-${suffix}`;
const PROJECT_API_KEY = `sk-lw-ikc-${suffix}`;
const TEMPLATE_ID = `tmpl-ikc-${suffix}`;
const SOURCE = "claude_cowork";

type McpTool = (args: Record<string, unknown>) => Promise<{
  content: Array<{ text: string }>;
}>;

/** The MCP surface under test, invoked the way the server would. */
function mcpTools(): Map<string, McpTool> {
  const tools = new Map<string, McpTool>();
  const server = {
    tool: (name: string, _d: unknown, _s: unknown, cb: McpTool) => {
      tools.set(name, cb);
      return null;
    },
  };
  registerGovernanceMcpTools(server as never, {
    prisma,
    apiKey: PROJECT_API_KEY,
    callerUserId: USER_ID,
  });
  return tools;
}

async function mintThroughMcp(args: {
  source_type: string;
  template_id?: string;
}): Promise<{ token: string; apiKeyId: string }> {
  const mint = mcpTools().get("governance_ingestion_keys_mint");
  if (!mint)
    throw new Error("governance_ingestion_keys_mint is not registered");
  const result = await mint(args);
  return JSON.parse(result.content.map((part) => part.text).join("")) as {
    token: string;
    apiKeyId: string;
  };
}

/**
 * Whether a token still gets through the resolver every trace-write endpoint
 * authorizes with. A revoked key resolves to nothing, which is the 401.
 */
async function authorizesTraceWrites(token: string): Promise<boolean> {
  const resolved = await TokenResolver.create(prisma).resolve({ token });
  return resolved !== null;
}

function caller() {
  return appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: USER_ID }, expires: "1" } as never,
    }),
  );
}

async function liveKeyIds(sourceType = SOURCE): Promise<string[]> {
  const rows = await prisma.apiKey.findMany({
    where: {
      organizationId: ORG_ID,
      ingestSourceType: sourceType,
      revokedAt: null,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => row.id);
}

describe("personal ingest keys minted outside the CLI", () => {
  const service = IngestionKeyService.create(prisma);
  /** Every token handed out before the rotation, in the order it was minted. */
  const priorTokens: string[] = [];

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `IKC ${suffix}`, slug: ORG_ID },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@example.com`, name: "Jane" },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        organizationId: ORG_ID,
        name: `team ${suffix}`,
        slug: `team-ikc-${suffix}`,
        ownerUserId: USER_ID,
        isPersonal: true,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        teamId: TEAM_ID,
        name: `personal ${suffix}`,
        slug: `prj-ikc-${suffix}`,
        ownerUserId: USER_ID,
        isPersonal: true,
        apiKey: PROJECT_API_KEY,
        language: "typescript",
        framework: "other",
      },
    });
    await prisma.ingestionTemplate.create({
      data: {
        id: TEMPLATE_ID,
        organizationId: null,
        slug: `cowork_${suffix}`,
        sourceType: SOURCE,
        displayName: "Claude Cowork",
        iconAsset: "preset:claude_cowork",
        ottlRules: "",
        platformPublished: true,
        enabled: true,
      },
    });
  });

  afterAll(async () => {
    for (const del of [
      () =>
        prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } }),
      () => prisma.apiKey.deleteMany({ where: { organizationId: ORG_ID } }),
      () => prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } }),
      () => prisma.ingestionTemplate.deleteMany({ where: { id: TEMPLATE_ID } }),
      () => prisma.project.deleteMany({ where: { teamId: TEAM_ID } }),
      () => prisma.team.deleteMany({ where: { organizationId: ORG_ID } }),
      () =>
        prisma.organizationUser.deleteMany({
          where: { organizationId: ORG_ID },
        }),
      () => prisma.user.deleteMany({ where: { id: USER_ID } }),
      () => prisma.organization.deleteMany({ where: { id: ORG_ID } }),
    ]) {
      await del().catch(() => undefined);
    }
  });

  describe("when the tile connects a template source that is already connected", () => {
    /** @scenario "Connecting a template source from the personal tile adds a key" */
    it("adds a key and leaves the earlier one authorizing", async () => {
      const first = await caller().ingestionKey.install({
        organizationId: ORG_ID,
        sourceType: SOURCE,
        templateId: TEMPLATE_ID,
      });
      priorTokens.push(first.token);

      const second = await caller().ingestionKey.install({
        organizationId: ORG_ID,
        sourceType: SOURCE,
        templateId: TEMPLATE_ID,
      });
      priorTokens.push(second.token);

      const live = await liveKeyIds();
      expect(live).toEqual([first.apiKeyId, second.apiKeyId]);
      expect(await authorizesTraceWrites(first.token)).toBe(true);
      expect(await authorizesTraceWrites(second.token)).toBe(true);
      const row = await prisma.apiKey.findUniqueOrThrow({
        where: { id: second.apiKeyId },
        select: { parentApiKeyId: true, ingestionTemplateId: true },
      });
      expect(row.parentApiKeyId).toBeNull();
      expect(row.ingestionTemplateId).toBe(TEMPLATE_ID);
    });
  });

  describe("when an agent mints the same template source through MCP", () => {
    /** @scenario "An agent minting a template source through MCP adds a key" */
    it("adds a key and revokes none", async () => {
      const before = await liveKeyIds();

      const minted = await mintThroughMcp({
        source_type: SOURCE,
        template_id: TEMPLATE_ID,
      });
      priorTokens.push(minted.token);

      const live = await liveKeyIds();
      // Every key that was live before an agent asked for one is still live:
      // the machines exporting with them never learn about this call.
      expect(live).toEqual(expect.arrayContaining(before));
      expect(live).toHaveLength(before.length + 1);
    });
  });

  describe("when the tile or an agent asks for a tool the CLI wraps", () => {
    /** @scenario "The tile and the MCP mint refuse a tool the CLI wraps" */
    it("refuses both with ingestion_key_source_not_allowed and mints nothing", async () => {
      const before = await liveKeyIds("claude_code");

      await expect(
        caller().ingestionKey.install({
          organizationId: ORG_ID,
          sourceType: "claude_code",
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "ingestion_key_source_not_allowed",
        }),
      });
      await expect(
        mintThroughMcp({ source_type: "claude_code" }),
      ).rejects.toMatchObject({ code: "ingestion_key_source_not_allowed" });

      expect(await liveKeyIds("claude_code")).toEqual(before);
    });
  });

  describe("when the tile rotates the source", () => {
    /** @scenario "Rotating a template source from the tile revokes every key for it and says how many" */
    it("leaves one new key authorizing, every prior token refused, and says how many there were", async () => {
      const before = await liveKeyIds();
      expect(before.length).toBe(3);
      expect(priorTokens).toHaveLength(before.length);

      const rotated = await caller().ingestionKey.rotate({
        organizationId: ORG_ID,
        sourceType: SOURCE,
        templateId: TEMPLATE_ID,
      });

      expect(rotated.revokedCount).toBe(3);
      expect(rotated.revokedDeviceLabels).toHaveLength(3);
      // A row read is not the claim being made, so each prior token goes
      // back through the resolver the trace-write endpoints authorize with.
      const live = await liveKeyIds();
      expect(live).toEqual([rotated.apiKeyId]);
      expect(await authorizesTraceWrites(rotated.token)).toBe(true);
      for (const token of priorTokens) {
        expect(await authorizesTraceWrites(token)).toBe(false);
      }
      const revoked = await prisma.apiKey.findMany({
        where: { organizationId: ORG_ID, id: { in: before } },
        select: { revocationCause: true },
      });
      expect(revoked.map((row) => row.revocationCause)).toEqual([
        "rotation",
        "rotation",
        "rotation",
      ]);
    });
  });

  describe("when an agent revokes one of the caller's keys through MCP", () => {
    it("stops that token and lists it no more", async () => {
      const minted = await mintThroughMcp({
        source_type: SOURCE,
        template_id: TEMPLATE_ID,
      });
      const revoke = mcpTools().get("governance_ingestion_keys_revoke");
      if (!revoke) {
        throw new Error("governance_ingestion_keys_revoke is not registered");
      }

      await revoke({ api_key_id: minted.apiKeyId });

      expect(await authorizesTraceWrites(minted.token)).toBe(false);
      const listed = await service.list({
        userId: USER_ID,
        organizationId: ORG_ID,
      });
      expect(listed.map((key) => key.apiKeyId)).not.toContain(minted.apiKeyId);
      // Revoking it again is not an error.
      await expect(
        revoke({ api_key_id: minted.apiKeyId }),
      ).resolves.toBeTruthy();
    });
  });
});
