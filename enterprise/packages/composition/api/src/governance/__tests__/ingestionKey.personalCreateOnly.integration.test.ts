// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * The CLI is not the only door to a personal ingest key: the /me Trace Ingest
 * tile connects a source, and an agent mints one through MCP. Both used to
 * rotate in place, so either one revoked the key every machine under that
 * login was exporting with, which is the failure the create-only CLI mint was
 * built to end. They add a key now. The tile's explicit rotate still does not.
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

import { IngestionKeyService } from "../../../../../../modules/governance/server/src/services/ingestion-source-key.service.ts";

wireDefaultTestApp();

const suffix = nanoid(8);
const ORG_ID = `org-ikc-${suffix}`;
const USER_ID = `usr-ikc-${suffix}`;
const TEAM_ID = `team-ikc-${suffix}`;
const PROJECT_ID = `prj-ikc-${suffix}`;
const PROJECT_API_KEY = `sk-lw-ikc-${suffix}`;

/** The one MCP surface under test, invoked the way the server would. */
async function mintThroughMcp(sourceType: string): Promise<string> {
  const tools = new Map<string, (args: any) => Promise<unknown>>();
  const server = {
    tool: (
      name: string,
      _d: unknown,
      _s: unknown,
      cb: (a: any) => Promise<unknown>,
    ) => {
      tools.set(name, cb);
      return null;
    },
  };
  registerGovernanceMcpTools(server as never, {
    prisma,
    apiKey: PROJECT_API_KEY,
    callerUserId: USER_ID,
  });
  const mint = tools.get("governance_ingestion_keys_mint");
  if (!mint)
    throw new Error("governance_ingestion_keys_mint is not registered");
  const result = (await mint({ source_type: sourceType })) as {
    content: Array<{ text: string }>;
  };
  const issued = JSON.parse(
    result.content.map((part) => part.text).join(""),
  ) as { token: string };
  return issued.token;
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

async function liveKeyIds(): Promise<string[]> {
  const rows = await prisma.apiKey.findMany({
    where: {
      organizationId: ORG_ID,
      ingestSourceType: "claude_code",
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
  });

  afterAll(async () => {
    for (const del of [
      () =>
        prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } }),
      () => prisma.apiKey.deleteMany({ where: { organizationId: ORG_ID } }),
      () => prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } }),
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

  describe("when a device already holds a key and the tile connects the source", () => {
    /** @scenario "Connecting a source from the personal tile keeps the devices' keys" */
    it("adds a key and leaves the device's own authorizing", async () => {
      const laptop = await service.issueForPersonalProject({
        userId: USER_ID,
        organizationId: ORG_ID,
        sourceType: "claude_code",
      });
      priorTokens.push(laptop.token);

      const installed = await caller().ingestionKey.install({
        organizationId: ORG_ID,
        sourceType: "claude_code",
      });
      priorTokens.push(installed.token);

      const live = await liveKeyIds();
      expect(live).toContain(laptop.apiKeyId);
      expect(live).toHaveLength(2);
      expect(await authorizesTraceWrites(laptop.token)).toBe(true);
    });
  });

  describe("when a device already holds a key and an agent mints through MCP", () => {
    /** @scenario "An agent minting through MCP keeps the devices' keys" */
    it("adds a key and revokes none", async () => {
      const before = await liveKeyIds();

      priorTokens.push(await mintThroughMcp("claude_code"));

      const live = await liveKeyIds();
      // Every key that was live before an agent asked for one is still live:
      // the machines exporting with them never learn about this call.
      expect(live).toEqual(expect.arrayContaining(before));
      expect(live).toHaveLength(before.length + 1);
    });
  });

  describe("when the tile rotates the source", () => {
    /** @scenario "An explicit rotation from the personal tile revokes every prior key" */
    it("leaves one new key authorizing and every prior token refused", async () => {
      const before = await liveKeyIds();
      expect(before.length).toBeGreaterThan(1);
      expect(priorTokens).toHaveLength(before.length);

      const rotated = await caller().ingestionKey.rotate({
        organizationId: ORG_ID,
        sourceType: "claude_code",
      });

      // Rotation is the verb that kills the other machines' keys, and it is
      // the only one that still does. A row read is not the claim being
      // made, so each prior token goes back through the resolver the
      // trace-write endpoints authorize with.
      const live = await liveKeyIds();
      expect(live).toHaveLength(1);
      expect(before).not.toContain(live[0]);
      expect(await authorizesTraceWrites(rotated.token)).toBe(true);
      for (const token of priorTokens) {
        expect(await authorizesTraceWrites(token)).toBe(false);
      }
    });
  });
});
