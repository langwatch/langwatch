/**
 * @vitest-environment node
 *
 * Integration coverage for the CLI login personal-project guards on
 * `POST /api/auth/cli/approve` (real Redis + real Prisma):
 *
 *   1. device-session (AI-tools) login is refused when governance is not
 *      enabled for the org, since it would otherwise provision a personal
 *      workspace + VK and capture the user's evaluations (customer report).
 *   2. project-login (project_api_key) refuses a personal project id and only
 *      hands back a shared project's key.
 *
 * The browser normally drives /approve behind a NextAuth session; we stub only
 * that identity (the auth boundary) and let every governance / project / DB
 * call run for real.
 *
 * Spec: specs/ai-gateway/governance/cli-login-personal-guard.feature
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above every top-level const, so the values the session
// mock needs must come from vi.hoisted (hoisted alongside it). Math.random,
// not nanoid, since imports aren't available inside the hoisted block.
const ids = vi.hoisted(() => {
  const s = Math.random().toString(36).slice(2, 10);
  return {
    suffix: s,
    USER_ID: `usr-guard-${s}`,
    EMAIL: `guard-${s}@example.com`,
    NAME: `Guard ${s}`,
  };
});

// Only the auth identity is stubbed; the DB/governance calls are real.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { id: ids.USER_ID, email: ids.EMAIL, name: ids.NAME },
  }),
}));
// The picked shared project's key requires project:update; that RBAC decision
// is covered elsewhere. Grant it so the gate logic is what's under test.
vi.mock("~/server/api/rbac", async (importActual) => {
  const actual = await importActual<typeof import("~/server/api/rbac")>();
  return { ...actual, hasProjectPermission: vi.fn().mockResolvedValue(true) };
});

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { app } from "../auth-cli";

const suffix = ids.suffix;
const ORG_ID = `org-guard-${suffix}`;
const TEAM_ID = `team-guard-${suffix}`;
const PTEAM_ID = `pteam-guard-${suffix}`;
const USER_ID = ids.USER_ID;
const SHARED_PROJECT_ID = `proj-shared-${suffix}`;
const PERSONAL_PROJECT_ID = `proj-personal-${suffix}`;
const SHARED_API_KEY = `sk-lw-shared-${suffix}-${"a".repeat(36)}`;
const PERSONAL_API_KEY = `sk-lw-personal-${suffix}-${"b".repeat(36)}`;

const GOV_FLAG = "release_ui_ai_governance_enabled";

async function mintDeviceCode(credentialType: string): Promise<string> {
  const res = await app.request("/api/auth/cli/device-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential_type: credentialType }),
  });
  const dc = (await res.json()) as { user_code: string };
  return dc.user_code;
}

async function approve(body: Record<string, unknown>) {
  const res = await app.request("/api/auth/cli/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: ORG_ID, ...body }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("CLI login personal-project guards", () => {
  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Guard Org ${suffix}`, slug: `guard-${suffix}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `guard-${suffix}@example.com`, name: `Guard ${suffix}` },
    });
    await prisma.organizationUser.create({
      data: { userId: USER_ID, organizationId: ORG_ID, role: "ADMIN" },
    });
    // Shared (team) project + a personal-workspace project for the same user.
    await prisma.team.create({
      data: { id: TEAM_ID, name: `Team ${suffix}`, slug: `team-${suffix}`, organizationId: ORG_ID },
    });
    await prisma.teamUser.create({ data: { userId: USER_ID, teamId: TEAM_ID, role: "ADMIN" } });
    await prisma.project.create({
      data: {
        id: SHARED_PROJECT_ID, name: `Shared ${suffix}`, slug: `shared-${suffix}`,
        apiKey: SHARED_API_KEY, teamId: TEAM_ID, language: "typescript", framework: "openai",
        isPersonal: false,
      },
    });
    await prisma.team.create({
      data: {
        id: PTEAM_ID, name: `Personal ${suffix}`, slug: `pteam-${suffix}`,
        organizationId: ORG_ID, isPersonal: true, ownerUserId: USER_ID,
      },
    });
    await prisma.teamUser.create({ data: { userId: USER_ID, teamId: PTEAM_ID, role: "ADMIN" } });
    await prisma.project.create({
      data: {
        id: PERSONAL_PROJECT_ID, name: `My Workspace ${suffix}`, slug: `personal-${suffix}`,
        apiKey: PERSONAL_API_KEY, teamId: PTEAM_ID, language: "typescript", framework: "openai",
        isPersonal: true, ownerUserId: USER_ID,
      },
    });
  });

  // Reset the governance baseline (off) before every test: the dev .env
  // force-enables the flag, so clearing it BEFORE each case is what guarantees
  // isolation, and a failed assertion can never leak the forced flag forward.
  // The one governance-on case opts in explicitly in its own body.
  beforeEach(() => {
    delete process.env.FEATURE_FLAG_FORCE_ENABLE;
  });

  afterAll(async () => {
    delete process.env.FEATURE_FLAG_FORCE_ENABLE;
    await prisma.virtualKey.deleteMany({ where: { principalUserId: USER_ID } }).catch(() => {});
    await prisma.project.deleteMany({ where: { teamId: { in: [TEAM_ID, PTEAM_ID] } } }).catch(() => {});
    await prisma.teamUser.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: { in: [TEAM_ID, PTEAM_ID] } } }).catch(() => {});
    await prisma.organizationUser.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: ORG_ID } }).catch(() => {});
    await stopTestContainers().catch(() => {});
  });

  describe("given an organization without governance enabled", () => {
    describe("when a device-session approval is requested", () => {
      /** @scenario device-session approval is refused when governance is disabled */
      it("refuses it with governance_required and mints no personal VK", async () => {
        const userCode = await mintDeviceCode("device_session");

        const { status, json } = await approve({ user_code: userCode });

        expect(status).toBe(403);
        expect(json.error).toBe("governance_required");
        const vks = await prisma.virtualKey.findMany({ where: { principalUserId: USER_ID } });
        expect(vks).toHaveLength(0);
      });
    });
  });

  describe("given an organization with governance enabled", () => {
    describe("when a device-session approval is requested", () => {
      /** @scenario device-session approval succeeds when governance is enabled */
      it("does not refuse the device-session approval", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = GOV_FLAG;
        const userCode = await mintDeviceCode("device_session");

        const { status } = await approve({ user_code: userCode });

        // Either a VK is issued (200) or the no-provider graceful fallback (200);
        // the gate must NOT block it.
        expect(status).not.toBe(403);
      });
    });
  });

  describe("given a project-login (project_api_key) approval", () => {
    describe("when the approval targets a personal project id", () => {
      /** @scenario project-login approval rejects a personal project id */
      it("rejects it and does not return its API key", async () => {
        const userCode = await mintDeviceCode("project_api_key");

        const { status, json } = await approve({
          user_code: userCode,
          project_id: PERSONAL_PROJECT_ID,
        });

        expect(status).toBe(400);
        expect(json.error).toBe("personal_project_not_allowed");
        expect(JSON.stringify(json)).not.toContain(PERSONAL_API_KEY);
      });
    });

    describe("when the approval targets a shared team project id", () => {
      /** @scenario project-login approval returns the shared project's key */
      it("approves it and returns that project", async () => {
        const userCode = await mintDeviceCode("project_api_key");

        const { status, json } = await approve({
          user_code: userCode,
          project_id: SHARED_PROJECT_ID,
        });

        expect(status).toBe(200);
        expect((json.project as { id: string }).id).toBe(SHARED_PROJECT_ID);
      });
    });
  });
});
