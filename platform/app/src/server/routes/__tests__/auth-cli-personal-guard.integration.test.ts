/**
 * @vitest-environment node
 *
 * Integration coverage for the CLI login personal-project guards on
 * `POST /api/auth/cli/approve` (real Redis + real Prisma):
 *
 *   1. device-session (AI-tools) login works by default (the governance flag
 *      ships on, ADR-038 Decision 7) and is refused for an org whose flag is
 *      switched off, since it would otherwise provision a personal workspace
 *      and capture the user's evaluations (customer report).
 *   2. approval mints NO virtual key, however many times the user logs in.
 *      The org fixture has an eligible ModelProvider, so a mint here would
 *      succeed if the handler still attempted one.
 *   3. project-login (project_api_key) refuses a personal project id and only
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
// The approval route reads probeProjectPermission from the app-layer
// imperative module (it moved off ~/server/api/rbac with ADR-092); mocking
// the old path leaves the real check running and the deny test inert.
vi.mock("~/server/app-layer/permissions/imperative", async (importActual) => {
  const actual =
    await importActual<typeof import("~/server/app-layer/permissions/imperative")>();
  return { ...actual, probeProjectPermission: vi.fn().mockResolvedValue(true) };
});

import type { Redis } from "ioredis";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { createTestApp } from "~/server/app-layer/presets";
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
// A second team the user is an org admin over but holds NO TeamUser row on.
const OTHER_TEAM_ID = `oteam-guard-${suffix}`;
const USER_ID = ids.USER_ID;
// A second org member whose personal project must stay unreachable.
const OTHER_USER_ID = `usr-guard-other-${suffix}`;
const OTHER_PTEAM_ID = `pteam-guard-other-${suffix}`;
const SHARED_PROJECT_ID = `proj-shared-${suffix}`;
const PERSONAL_PROJECT_ID = `proj-personal-${suffix}`;
const OTHER_PERSONAL_PROJECT_ID = `proj-personal-other-${suffix}`;
const OTHER_TEAM_PROJECT_ID = `proj-other-${suffix}`;
const MODEL_PROVIDER_ID = `mp-guard-${suffix}`;
const SHARED_API_KEY = `sk-lw-shared-${suffix}-${"a".repeat(36)}`;
const PERSONAL_API_KEY = `sk-lw-personal-${suffix}-${"b".repeat(36)}`;
const OTHER_PERSONAL_API_KEY = `sk-lw-personal-o-${suffix}-${"d".repeat(34)}`;
const OTHER_TEAM_API_KEY = `sk-lw-other-${suffix}-${"c".repeat(36)}`;

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
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** Personal VKs the approve path could have minted for the fixture user. */
async function personalVkCount(): Promise<number> {
  return await prisma.virtualKey.count({
    where: { organizationId: ORG_ID, principalUserId: USER_ID },
  });
}

/** The container's connection; /api/auth/cli/* requires one on the App. */
let redisConnection: Redis | null = null;

describe("CLI login personal-project guards", () => {
  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({ redis: redisConnection });
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `Guard Org ${suffix}`,
        slug: `guard-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `guard-${suffix}@example.com`,
        name: `Guard ${suffix}`,
      },
    });
    await prisma.organizationUser.create({
      data: { userId: USER_ID, organizationId: ORG_ID, role: "ADMIN" },
    });
    // Shared (team) project + a personal-workspace project for the same user.
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Team ${suffix}`,
        slug: `team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.teamUser.create({
      data: { userId: USER_ID, teamId: TEAM_ID, role: "ADMIN" },
    });
    await prisma.project.create({
      data: {
        id: SHARED_PROJECT_ID,
        name: `Shared ${suffix}`,
        slug: `shared-${suffix}`,
        apiKey: SHARED_API_KEY,
        teamId: TEAM_ID,
        language: "typescript",
        framework: "openai",
        isPersonal: false,
      },
    });
    await prisma.team.create({
      data: {
        id: PTEAM_ID,
        name: `Personal ${suffix}`,
        slug: `pteam-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: USER_ID,
      },
    });
    await prisma.teamUser.create({
      data: { userId: USER_ID, teamId: PTEAM_ID, role: "ADMIN" },
    });
    await prisma.project.create({
      data: {
        id: PERSONAL_PROJECT_ID,
        name: `My Workspace ${suffix}`,
        slug: `personal-${suffix}`,
        apiKey: PERSONAL_API_KEY,
        teamId: PTEAM_ID,
        language: "typescript",
        framework: "openai",
        isPersonal: true,
        ownerUserId: USER_ID,
      },
    });
    // A second org member with their own personal workspace. The caller may
    // be an org admin, and even then that personal project must never back a
    // project API key for anyone but its owner.
    await prisma.user.create({
      data: {
        id: OTHER_USER_ID,
        email: `guard-other-${suffix}@example.com`,
        name: `Guard Other ${suffix}`,
      },
    });
    await prisma.organizationUser.create({
      data: { userId: OTHER_USER_ID, organizationId: ORG_ID, role: "MEMBER" },
    });
    await prisma.team.create({
      data: {
        id: OTHER_PTEAM_ID,
        name: `Personal Other ${suffix}`,
        slug: `pteam-other-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: OTHER_USER_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: OTHER_PERSONAL_PROJECT_ID,
        name: `Their Workspace ${suffix}`,
        slug: `personal-other-${suffix}`,
        apiKey: OTHER_PERSONAL_API_KEY,
        teamId: OTHER_PTEAM_ID,
        language: "typescript",
        framework: "openai",
        isPersonal: true,
        ownerUserId: OTHER_USER_ID,
      },
    });
    // A shared project on a team the user is NOT a direct member of. The user
    // is an org ADMIN (organizationUser above), so they see it in the picker
    // via organization.getAll and hold project:update through the org scope,
    // but there is deliberately no TeamUser row for them on this team.
    await prisma.team.create({
      data: {
        id: OTHER_TEAM_ID,
        name: `Other ${suffix}`,
        slug: `oteam-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: OTHER_TEAM_PROJECT_ID,
        name: `Other ${suffix}`,
        slug: `other-${suffix}`,
        apiKey: OTHER_TEAM_API_KEY,
        teamId: OTHER_TEAM_ID,
        language: "typescript",
        framework: "openai",
        isPersonal: false,
      },
    });
    // An org-scoped provider the user's personal team can reach. Without it a
    // "no VK was minted" assertion would pass for the wrong reason: the mint
    // would have refused for lack of a provider rather than never running.
    await prisma.modelProvider.create({
      data: {
        id: MODEL_PROVIDER_ID,
        name: `guard-mp-${suffix}`,
        provider: "anthropic",
        enabled: true,
        organizationId: ORG_ID,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
  });

  // Clear flag overrides before every test: the dev .env may force-enable the
  // flag and a prior case forces it off, so clearing BOTH before each case is
  // what guarantees isolation: a failed assertion can never leak an override
  // forward. Cases that need a non-default state opt in explicitly in their
  // own body.
  beforeEach(() => {
    delete process.env.FEATURE_FLAG_FORCE_ENABLE;
    delete process.env.RELEASE_UI_AI_GOVERNANCE_ENABLED;
  });

  // Deletes are org-scoped rather than keyed on the fixture ids because the
  // approve path under test PROVISIONS rows with generated ids (the personal
  // team, its project, and role bindings); an id-list filter would strand
  // them. Dependency order, and no error swallowing: Team and Project carry
  // no cascade from Organization, so a stranded child would otherwise turn
  // every later run's org delete into a silent no-op and the leak would be
  // invisible.
  afterAll(async () => {
    await resetApp();
    delete process.env.FEATURE_FLAG_FORCE_ENABLE;
    delete process.env.RELEASE_UI_AI_GOVERNANCE_ENABLED;
    // organizationId, not principalUserId-in-list: the tenancy guard
    // extension on VirtualKey only honours scalar tenancy predicates, and
    // the org id covers every key the approve path can have minted here.
    await prisma.virtualKey.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.modelProviderScope.deleteMany({
      where: { modelProviderId: MODEL_PROVIDER_ID },
    });
    await prisma.modelProvider.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: ORG_ID },
    });
    // The device-session exchange now mints a user-scoped CLI ApiKey (plus
    // its private custom role); ApiKey→Organization is a Restrict relation,
    // so these go before the organization delete.
    await prisma.apiKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.project.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.teamUser.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await stopTestContainers().catch(() => {});
  });

  describe("given an organization with governance switched off", () => {
    describe("when a device-session approval is requested", () => {
      /** @scenario device-session approval is refused when governance is disabled */
      it("refuses it with governance_required and mints no personal VK", async () => {
        process.env.RELEASE_UI_AI_GOVERNANCE_ENABLED = "0";
        const userCode = await mintDeviceCode("device_session");

        const { status, json } = await approve({ user_code: userCode });

        expect(status).toBe(403);
        expect(json.error).toBe("governance_required");
        const vks = await prisma.virtualKey.findMany({
          where: { principalUserId: USER_ID },
        });
        expect(vks).toHaveLength(0);
      });
    });
  });

  describe("given a default installation with no flag overrides", () => {
    describe("when a device-session approval is requested", () => {
      /** @scenario device-session approval succeeds on a default installation */
      it("approves it and mints no virtual key", async () => {
        const userCode = await mintDeviceCode("device_session");

        const { status, json } = await approve({ user_code: userCode });

        expect(status).toBe(200);
        expect(json.ok).toBe(true);
        // The org has an eligible provider, so a mint attempt would have
        // succeeded. Login issues the key it no longer needs to.
        expect(await personalVkCount()).toBe(0);
      });
    });
  });

  describe("given an organization with governance force-enabled", () => {
    describe("when a device-session approval is requested", () => {
      /** @scenario device-session approval succeeds when governance is enabled */
      it("does not refuse the device-session approval", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = GOV_FLAG;
        const userCode = await mintDeviceCode("device_session");

        const { status } = await approve({ user_code: userCode });

        expect(status).toBe(200);
      });
    });

    describe("when the same user logs in again and again", () => {
      /** @scenario "Logging in again creates no virtual keys" */
      it("leaves the user with zero virtual keys after every approval", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = GOV_FLAG;

        for (let login = 0; login < 3; login++) {
          const userCode = await mintDeviceCode("device_session");
          const { status } = await approve({ user_code: userCode });
          expect(status).toBe(200);
          expect(await personalVkCount()).toBe(0);
        }
      });
    });

    describe("when the exchange that follows approval is polled", () => {
      /** @scenario "The personal virtual key is issued on first gateway use, not at login" */
      it("ships no default_personal_vk to the CLI", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = GOV_FLAG;
        const dcRes = await app.request("/api/auth/cli/device-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credential_type: "device_session" }),
        });
        const dc = (await dcRes.json()) as {
          device_code: string;
          user_code: string;
        };
        const { status } = await approve({ user_code: dc.user_code });
        expect(status).toBe(200);

        const exRes = await app.request("/api/auth/cli/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ device_code: dc.device_code }),
        });
        expect(exRes.status).toBe(200);
        const ex = (await exRes.json()) as Record<string, unknown>;

        expect(ex.kind).toBe("device_session");
        expect(ex.access_token).toEqual(expect.stringMatching(/^lw_at_/));
        expect(ex.default_personal_vk).toBeUndefined();
        expect(await personalVkCount()).toBe(0);
      });
    });
  });

  describe("given a project-login (project_api_key) approval", () => {
    describe("when the approval targets another user's personal project id", () => {
      /** @scenario project-login approval rejects another user's personal project id */
      it("rejects it and does not return its API key", async () => {
        const userCode = await mintDeviceCode("project_api_key");

        const { status, json } = await approve({
          user_code: userCode,
          project_id: OTHER_PERSONAL_PROJECT_ID,
        });

        expect(status).toBe(400);
        expect(json.error).toBe("personal_project_not_allowed");
        expect(JSON.stringify(json)).not.toContain(OTHER_PERSONAL_API_KEY);
      });
    });

    describe("when the caller explicitly picks their OWN personal project", () => {
      /** @scenario project-login approval honours the caller's own explicitly picked personal project */
      it("approves it and returns the personal project", async () => {
        // The hazard this guard exists for was silent AUTO-selection; an
        // explicit self-pick in the browser is a deliberate act and the
        // personal project is a normal project with a normal apiKey.
        const userCode = await mintDeviceCode("project_api_key");

        const { status, json } = await approve({
          user_code: userCode,
          project_id: PERSONAL_PROJECT_ID,
        });

        expect(status).toBe(200);
        expect((json.project as { id: string }).id).toBe(PERSONAL_PROJECT_ID);
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

    describe("when an org admin approves a project on a team they do not belong to", () => {
      /** @scenario project-login approval allows an org admin who is not a direct team member */
      it("does not pre-filter on team membership and defers to the write-permission check", async () => {
        // Org admins see every team's projects in the picker but may hold
        // project:update only through an org-scoped binding, not a TeamUser
        // row. The approval lookup must not reject them before the real RBAC
        // check (mocked true here) runs.
        const userCode = await mintDeviceCode("project_api_key");

        const { status, json } = await approve({
          user_code: userCode,
          project_id: OTHER_TEAM_PROJECT_ID,
        });

        expect(status).toBe(200);
        expect((json.project as { id: string }).id).toBe(OTHER_TEAM_PROJECT_ID);
      });
    });

    describe("when the caller's own seat has been disabled", () => {
      /** @scenario project-login approval denies a member whose seat has been disabled */
      it("returns forbidden and never the project's API key", async () => {
        // The row stays, with its ADMIN role — only the access is gone. A
        // project key has no owner, so nothing downstream would have caught
        // this: the membership gate on approve is the whole defence.
        await prisma.organizationUser.updateMany({
          where: { userId: USER_ID, organizationId: ORG_ID },
          data: { disabledAt: new Date() },
        });
        try {
          const userCode = await mintDeviceCode("project_api_key");

          const { status, json } = await approve({
            user_code: userCode,
            project_id: SHARED_PROJECT_ID,
          });

          expect(status).toBe(403);
          expect(json.error).toBe("forbidden");
          expect(JSON.stringify(json)).not.toContain(SHARED_API_KEY);
        } finally {
          await prisma.organizationUser.updateMany({
            where: { userId: USER_ID, organizationId: ORG_ID },
            data: { disabledAt: null },
          });
        }
      });
    });

    describe("when the seat is disabled between approval and exchange", () => {
      /** @scenario project-login exchange denies a member whose seat was disabled after approval */
      it("answers the fatal access_denied, never the project's API key, and consumes the code", async () => {
        // Approval is not the last word: the code is exchanged later, and an
        // admin can switch the seat off in between. The handout is what must
        // re-derive membership.
        const dcRes = await app.request("/api/auth/cli/device-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credential_type: "project_api_key" }),
        });
        const dc = (await dcRes.json()) as {
          device_code: string;
          user_code: string;
        };
        const approved = await approve({
          user_code: dc.user_code,
          project_id: SHARED_PROJECT_ID,
        });
        expect(approved.status).toBe(200);

        await prisma.organizationUser.updateMany({
          where: { userId: USER_ID, organizationId: ORG_ID },
          data: { disabledAt: new Date() },
        });
        try {
          const exchange = () =>
            app.request("/api/auth/cli/exchange", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ device_code: dc.device_code }),
            });

          const first = await exchange();
          // 410 access_denied: the one answer the CLI already treats as
          // fatal, and the same one a removed member gets from the mint.
          expect(first.status).toBe(410);
          expect(await first.text()).not.toContain(SHARED_API_KEY);

          // Consumed: the record is gone from Redis, and a CLI still polling
          // is told the code expired rather than that it polled too soon or
          // left waiting on an approval that will never be honoured.
          expect(
            await redisConnection!.get(`lwcli:device:${dc.device_code}`),
          ).toBeNull();
          const second = await exchange();
          expect(second.status).toBe(408);
        } finally {
          await prisma.organizationUser.updateMany({
            where: { userId: USER_ID, organizationId: ORG_ID },
            data: { disabledAt: null },
          });
        }
      });
    });

    describe("when the caller lacks write access to the picked project", () => {
      /** @scenario project-login approval denies a project the caller cannot write */
      it("returns forbidden and never the project's API key", async () => {
        // probeProjectPermission is the source of truth: a caller without
        // project:update is denied even though the project is in their org.
        vi.mocked(probeProjectPermission).mockResolvedValueOnce(false);
        const userCode = await mintDeviceCode("project_api_key");

        const { status, json } = await approve({
          user_code: userCode,
          project_id: OTHER_TEAM_PROJECT_ID,
        });

        expect(status).toBe(403);
        expect(json.error).toBe("forbidden");
        expect(JSON.stringify(json)).not.toContain(OTHER_TEAM_API_KEY);
      });
    });
  });
});
