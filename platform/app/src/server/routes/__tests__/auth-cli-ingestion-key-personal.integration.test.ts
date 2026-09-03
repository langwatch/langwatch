/**
 * @vitest-environment node
 *
 * The personal-workspace branch of `POST /api/auth/cli/governance/ingestion-key`:
 * one key per device, create-only, capped per tool. Two devices under one
 * login each keep a working token, and past the cap the key that has gone
 * unused the longest is the one revoked.
 *
 * Feature: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */

import { PERSONAL_INGEST_KEYS_PER_TOOL_CAP } from "@ee/governance/services/ingestionKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { app } from "../auth-cli";

const suffix = nanoid(8);
const ORG_ID = `org-ikpp-${suffix}`;
const USER_ID = `usr-ikpp-${suffix}`;
const TOKEN = `lw_at_${"p".repeat(43)}-ikpp-${suffix}`;

let redisConnection: Redis | null = null;
let personalProjectId = "";

async function mintPersonal(
  sourceType: string,
): Promise<{ status: number; token: string; prefix: string }> {
  const res = await app.request("/api/auth/cli/governance/ingestion-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ source_type: sourceType }),
  });
  const json = (await res.json()) as { token: string; prefix: string };
  return { status: res.status, token: json.token, prefix: json.prefix };
}

async function liveKeysFor(sourceType: string) {
  return prisma.apiKey.findMany({
    where: {
      organizationId: ORG_ID,
      ingestSourceType: sourceType,
      revokedAt: null,
      roleBindings: {
        some: { scopeType: "PROJECT", scopeId: personalProjectId },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

describe("POST /api/auth/cli/governance/ingestion-key for the personal workspace", () => {
  const resolver = TokenResolver.create(prisma);

  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({ redis: redisConnection });

    await prisma.organization.create({
      data: { id: ORG_ID, name: `IKPP ${suffix}`, slug: `ikpp-${suffix}` },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `ikpp-${suffix}@example.com`,
        name: "IKPP User",
      },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: USER_ID, role: "ADMIN" },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      },
    });
    const workspace = await new PersonalWorkspaceService(prisma).ensure({
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    personalProjectId = workspace.project.id;

    if (!redisConnection) throw new Error("Redis unavailable in test env");
    await redisConnection.set(
      `lwcli:access:${TOKEN}`,
      JSON.stringify({
        user_id: USER_ID,
        organization_id: ORG_ID,
        issued_at: Date.now(),
        expires_at: Date.now() + 60 * 60 * 1000,
        client_info: { hostname: "laptop" },
      }),
      "EX",
      60 * 60,
    );
  }, 60_000);

  afterAll(async () => {
    if (redisConnection) await redisConnection.del(`lwcli:access:${TOKEN}`);
    await prisma.roleBinding
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.apiKey
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { team: { organizationId: ORG_ID } } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: USER_ID } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => undefined);
    await stopTestContainers();
  });

  describe("given a laptop that already minted a personal key for a tool", () => {
    /** @scenario "Two devices each keep a live personal key for the same tool" */
    it("lets a second device mint its own key without revoking the first", async () => {
      const laptop = await mintPersonal("codex");
      const desktop = await mintPersonal("codex");
      expect(laptop.status).toBe(201);
      expect(desktop.status).toBe(201);
      expect(desktop.token).not.toBe(laptop.token);

      for (const token of [laptop.token, desktop.token]) {
        const resolved = await resolver.resolve({ token, projectId: null });
        expect(resolved?.type).toBe("apiKey");
        if (resolved?.type === "apiKey") {
          expect(resolved.project.id).toBe(personalProjectId);
        }
      }
      expect(await liveKeysFor("codex")).toHaveLength(2);
    });
  });

  describe("given a workspace holding the cap of live keys for a tool", () => {
    const tokens: string[] = [];

    beforeAll(async () => {
      for (let i = 0; i < PERSONAL_INGEST_KEYS_PER_TOOL_CAP; i += 1) {
        tokens.push((await mintPersonal("claude_code")).token);
      }
      // The third key was last used a month ago; every other key just now.
      const live = await liveKeysFor("claude_code");
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for (const [index, key] of live.entries()) {
        await prisma.apiKey.update({
          where: { id: key.id },
          data: { lastUsedAt: index === 2 ? monthAgo : new Date() },
        });
      }
    }, 60_000);

    /** @scenario "Personal keys per tool are capped, least recently used first" */
    it("revokes the key used least recently when another device mints", async () => {
      const before = await liveKeysFor("claude_code");
      const idle = before[2]!;

      const fresh = await mintPersonal("claude_code");
      expect(fresh.status).toBe(201);

      const after = await liveKeysFor("claude_code");
      expect(after).toHaveLength(PERSONAL_INGEST_KEYS_PER_TOOL_CAP);
      expect(after.map((key) => key.id)).not.toContain(idle.id);
      expect(
        await resolver.resolve({ token: fresh.token, projectId: null }),
      ).not.toBeNull();
      for (const [index, token] of tokens.entries()) {
        const resolved = await resolver.resolve({ token, projectId: null });
        if (index === 2) expect(resolved).toBeNull();
        else expect(resolved?.type).toBe("apiKey");
      }
    });

    /** @scenario "The cap counts one tool at a time" */
    it("leaves the full tool's keys alone when another tool mints", async () => {
      const before = (await liveKeysFor("claude_code")).map((key) => key.id);

      const other = await mintPersonal("gemini");
      expect(other.status).toBe(201);

      const after = (await liveKeysFor("claude_code")).map((key) => key.id);
      expect(after).toEqual(before);
    });
  });
});
