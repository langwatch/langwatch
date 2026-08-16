/**
 * @vitest-environment node
 *
 * Integration coverage for the named-project branch of
 * POST /api/auth/cli/governance/ingestion-key against real Postgres + Redis.
 *
 * A repository checkout sends its coding-agent traces to the project that
 * owns the code, so the CLI names a project by id or slug. The branch is
 * create-only, unlike the personal-project branch, which rotates in place:
 * two machines on the same repository each keep a working token.
 *
 * The gate is `traces:create` on the named project, the same permission the
 * minted key carries. Resolution is confined to the caller's organization, so
 * a project in another tenant reads as "not found".
 *
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitApiKeyToken } from "~/server/api-key/api-key-token.utils";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { app } from "../auth-cli";

const suffix = nanoid(8);

const ORG_ID = `org-ikp-${suffix}`;
const OTHER_ORG_ID = `org-ikp-other-${suffix}`;
const TEAM_ID = `team-ikp-${suffix}`;
const OTHER_TEAM_ID = `team-ikp-other-${suffix}`;
const PROJECT_ID = `proj-ikp-${suffix}`;
const PROJECT_SLUG = `checkout-api-${suffix}`;
const OTHER_ORG_PROJECT_ID = `proj-ikp-other-${suffix}`;
const OTHER_ORG_PROJECT_SLUG = `other-co-api-${suffix}`;

// ADMIN holds traces:create through an org-scoped RoleBinding. VIEWER is an
// org member with no binding and no TeamUser row, so every project
// permission resolves false for them.
const ADMIN_ID = `usr-ikp-admin-${suffix}`;
const VIEWER_ID = `usr-ikp-viewer-${suffix}`;
// Offboarded mid-session: a member at token-issue time, no membership row by
// the time the token is presented.
const LEAVER_ID = `usr-ikp-leaver-${suffix}`;
const ADMIN_TOKEN = `lw_at_${"a".repeat(43)}-ikp-${suffix}`;
const VIEWER_TOKEN = `lw_at_${"v".repeat(43)}-ikp-${suffix}`;
const LEAVER_TOKEN = `lw_at_${"l".repeat(43)}-ikp-${suffix}`;

let redisConnection: Redis | null = null;

async function mintIngestionKey(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, any> }> {
  const res = await app.request("/api/auth/cli/governance/ingestion-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, any>,
  };
}

async function liveIngestKeyCount(projectId: string): Promise<number> {
  return await prisma.apiKey.count({
    where: {
      organizationId: ORG_ID,
      ingestSourceType: { not: null },
      revokedAt: null,
      roleBindings: { some: { scopeType: "PROJECT", scopeId: projectId } },
    },
  });
}

describe("POST /api/auth/cli/governance/ingestion-key with a named project", () => {
  const resolver = TokenResolver.create(prisma);

  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({ redis: redisConnection });

    await prisma.organization.create({
      data: { id: ORG_ID, name: `IKP ${suffix}`, slug: `ikp-${suffix}` },
    });
    await prisma.organization.create({
      data: {
        id: OTHER_ORG_ID,
        name: `IKP Other ${suffix}`,
        slug: `ikp-other-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: ADMIN_ID,
        email: `ikp-admin-${suffix}@example.com`,
        name: "IKP Admin",
      },
    });
    await prisma.user.create({
      data: {
        id: VIEWER_ID,
        email: `ikp-viewer-${suffix}@example.com`,
        name: "IKP Viewer",
      },
    });
    await prisma.user.create({
      data: {
        id: LEAVER_ID,
        email: `ikp-leaver-${suffix}@example.com`,
        name: "IKP Leaver",
      },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: ADMIN_ID, role: "ADMIN" },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: VIEWER_ID, role: "MEMBER" },
    });
    // Project permissions resolve through RoleBindings, not the legacy
    // OrganizationUser.role, so the admin needs an explicit org-scoped one.
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: ADMIN_ID,
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      },
    });

    await prisma.team.create({
      data: {
        id: TEAM_ID,
        organizationId: ORG_ID,
        name: `IKP Team ${suffix}`,
        slug: `ikp-team-${suffix}`,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        teamId: TEAM_ID,
        name: `Checkout API ${suffix}`,
        slug: PROJECT_SLUG,
        apiKey: `sk-lw-ikp-${suffix}-${"a".repeat(30)}`,
        language: "typescript",
        framework: "other",
      },
    });
    await prisma.team.create({
      data: {
        id: OTHER_TEAM_ID,
        organizationId: OTHER_ORG_ID,
        name: `IKP Other Team ${suffix}`,
        slug: `ikp-other-team-${suffix}`,
      },
    });
    await prisma.project.create({
      data: {
        id: OTHER_ORG_PROJECT_ID,
        teamId: OTHER_TEAM_ID,
        name: `Other Co API ${suffix}`,
        slug: OTHER_ORG_PROJECT_SLUG,
        apiKey: `sk-lw-ikpo-${suffix}-${"b".repeat(30)}`,
        language: "typescript",
        framework: "other",
      },
    });

    if (!redisConnection) throw new Error("Redis unavailable in test env");
    const redis = redisConnection;
    for (const [token, userId] of [
      [ADMIN_TOKEN, ADMIN_ID],
      [VIEWER_TOKEN, VIEWER_ID],
      [LEAVER_TOKEN, LEAVER_ID],
    ] as const) {
      await redis.set(
        `lwcli:access:${token}`,
        JSON.stringify({
          user_id: userId,
          organization_id: ORG_ID,
          issued_at: Date.now(),
          expires_at: Date.now() + 60 * 60 * 1000,
        }),
        "EX",
        60 * 60,
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (redisConnection) {
      await redisConnection.del(`lwcli:access:${ADMIN_TOKEN}`);
      await redisConnection.del(`lwcli:access:${VIEWER_TOKEN}`);
      await redisConnection.del(`lwcli:access:${LEAVER_TOKEN}`);
    }
    const orgs = [ORG_ID, OTHER_ORG_ID];
    await prisma.aiToolEntry.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    // RoleBindings reference ApiKeys, so they go first.
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.apiKey.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.customRole.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.project.deleteMany({
      where: { team: { organizationId: { in: orgs } } },
    });
    await prisma.teamUser.deleteMany({
      where: { team: { organizationId: { in: orgs } } },
    });
    await prisma.team.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_ID, VIEWER_ID, LEAVER_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await resetApp();
    await stopTestContainers();
  }, 60_000);

  describe("given a caller who can write traces into the project", () => {
    describe("when the project is named by id", () => {
      /** @scenario "The CLI mints an ingestion key for a project named by id" */
      it("mints a key bound to that project and returns it once", async () => {
        const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "claude_code",
          project: PROJECT_ID,
          device_label: "build-box-1",
        });

        expect(status).toBe(201);
        expect(json.token).toEqual(expect.stringMatching(/^ik-lw-/));
        expect(json.prefix).toEqual(expect.stringMatching(/^ik-lw-/));
        expect(json.endpoint).toEqual(expect.stringMatching(/\/api\/otel$/));
        expect(json.project).toEqual({
          id: PROJECT_ID,
          slug: PROJECT_SLUG,
          name: `Checkout API ${suffix}`,
        });

        // The token authorizes ingest and self-scopes to the named project.
        const resolved = await resolver.resolve({
          token: json.token as string,
          projectId: null,
        });
        expect(resolved?.type).toBe("apiKey");
        if (resolved?.type === "apiKey") {
          expect(resolved.project.id).toBe(PROJECT_ID);
          expect(resolved.ingestSourceType).toBe("claude_code");
        }
      });

      it("records the minting device on the key so its origin is readable", async () => {
        const { json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "codex",
          project: PROJECT_ID,
          device_label: "build-box-2",
        });
        const lookupId = splitApiKeyToken(json.token as string)?.lookupId;
        const row = await prisma.apiKey.findFirstOrThrow({
          where: { organizationId: ORG_ID, lookupId },
          select: { name: true, createdByDeviceLabel: true, userId: true },
        });
        expect(row.createdByDeviceLabel).toBe("build-box-2");
        expect(row.name).toContain("codex");
        expect(row.name).toContain("build-box-2");
        // A shared project's key is an org service key, owned by nobody, so
        // the whole team can see it in the API-keys list.
        expect(row.userId).toBeNull();
      });
    });

    describe("when the project is named by slug", () => {
      /** @scenario "The CLI mints an ingestion key for a project named by slug" */
      it("resolves the slug inside the caller's organization", async () => {
        const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "gemini",
          project: PROJECT_SLUG,
        });

        expect(status).toBe(201);
        expect(json.project.id).toBe(PROJECT_ID);
        expect(json.project.slug).toBe(PROJECT_SLUG);
      });
    });

    describe("when a second machine mints for the same project and tool", () => {
      /** @scenario "Two machines each keep a live key for the same project and tool" */
      it("leaves both tokens live, unlike the rotating personal branch", async () => {
        const first = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "opencode",
          project: PROJECT_ID,
          device_label: "laptop-a",
        });
        const second = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "opencode",
          project: PROJECT_ID,
          device_label: "laptop-b",
        });

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.json.token).not.toBe(first.json.token);

        for (const token of [first.json.token, second.json.token] as string[]) {
          const resolved = await resolver.resolve({ token, projectId: null });
          expect(resolved?.type).toBe("apiKey");
          if (resolved?.type === "apiKey") {
            expect(resolved.project.id).toBe(PROJECT_ID);
          }
        }
      });
    });
  });

  describe("given a caller without trace-write access to the project", () => {
    describe("when they name that project", () => {
      /** @scenario "Minting into a project the caller cannot write to is refused" */
      it("returns forbidden and mints nothing", async () => {
        const before = await liveIngestKeyCount(PROJECT_ID);

        const { status, json } = await mintIngestionKey(VIEWER_TOKEN, {
          source_type: "claude_code",
          project: PROJECT_ID,
        });

        expect(status).toBe(403);
        expect(json.error).toBe("forbidden");
        expect(json.token).toBeUndefined();
        expect(await liveIngestKeyCount(PROJECT_ID)).toBe(before);
      });
    });
  });

  describe("given a project in another organization", () => {
    describe("when the caller names it by id", () => {
      /** @scenario "A project in another organization is not found" */
      it("returns project_not_found without confirming it exists", async () => {
        const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "claude_code",
          project: OTHER_ORG_PROJECT_ID,
        });

        expect(status).toBe(404);
        expect(json.error).toBe("project_not_found");
      });
    });

    describe("when the caller names it by slug", () => {
      it("returns project_not_found as well", async () => {
        const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "claude_code",
          project: OTHER_ORG_PROJECT_SLUG,
        });

        expect(status).toBe(404);
        expect(json.error).toBe("project_not_found");
      });
    });
  });

  describe("given no project is named", () => {
    describe("when the caller has no personal workspace", () => {
      it("keeps the personal branch's precondition failure", async () => {
        const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "claude_code",
        });

        expect(status).toBe(412);
        expect(json.error).toBe("precondition_failed");
      });
    });
  });

  describe("given the caller left the organization after the token was issued", () => {
    it("refuses to mint on a pre-removal token", async () => {
      await prisma.organizationUser.create({
        data: { organizationId: ORG_ID, userId: LEAVER_ID, role: "MEMBER" },
      });
      await prisma.organizationUser.delete({
        where: {
          userId_organizationId: {
            userId: LEAVER_ID,
            organizationId: ORG_ID,
          },
        },
      });
      const before = await liveIngestKeyCount(PROJECT_ID);

      const { status, json } = await mintIngestionKey(LEAVER_TOKEN, {
        source_type: "claude_code",
        project: PROJECT_ID,
      });

      expect(status).toBe(403);
      expect(json.token).toBeUndefined();
      expect(await liveIngestKeyCount(PROJECT_ID)).toBe(before);
    });
  });

  describe("given a source type that names an inherited object property", () => {
    it("treats it as ungoverned rather than failing the request", async () => {
      const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
        source_type: "toString",
        project: PROJECT_ID,
      });

      expect(status).toBe(201);
      expect(json.token).toEqual(expect.stringMatching(/^ik-lw-/));
    });
  });

  describe("given the organization turned direct OTLP off for the tool", () => {
    const TILE_ID = `tile-ikp-${suffix}`;

    beforeAll(async () => {
      await prisma.aiToolEntry.create({
        data: {
          id: TILE_ID,
          organizationId: ORG_ID,
          scope: "organization",
          scopeId: ORG_ID,
          type: "coding_assistant",
          displayName: "Claude Code",
          slug: `claude-code-${suffix}`,
          config: { assistantKind: "claude_code", allowOtelDirect: false },
        },
      });
    });

    afterAll(async () => {
      await prisma.aiToolEntry.deleteMany({
        where: { id: TILE_ID, organizationId: ORG_ID },
      });
    });

    describe("when the CLI asks for a key anyway", () => {
      /** @scenario "A tool whose organization forbids direct OTLP mints no ingestion key" */
      it("refuses the project branch and mints nothing", async () => {
        const before = await liveIngestKeyCount(PROJECT_ID);

        const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "claude_code",
          project: PROJECT_ID,
        });

        expect(status).toBe(403);
        expect(json.error).toBe("direct_otel_not_allowed");
        expect(json.token).toBeUndefined();
        expect(await liveIngestKeyCount(PROJECT_ID)).toBe(before);
      });

      it("refuses the personal branch on the same policy", async () => {
        const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "claude_code",
        });

        expect(status).toBe(403);
        expect(json.error).toBe("direct_otel_not_allowed");
      });
    });

    describe("when the CLI asks for a tool the tile does not govern", () => {
      it("still mints, because the policy is per tool", async () => {
        const { status, json } = await mintIngestionKey(ADMIN_TOKEN, {
          source_type: "codex",
          project: PROJECT_ID,
        });

        expect(status).toBe(201);
        expect(json.token).toEqual(expect.stringMatching(/^ik-lw-/));
      });
    });
  });
});
