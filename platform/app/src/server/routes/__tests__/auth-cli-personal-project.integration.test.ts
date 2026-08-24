/**
 * @vitest-environment node
 *
 * Integration coverage for the /me credentials delivery (real Redis + real
 * Prisma + real ClickHouse wiring):
 *
 *   1. `POST /api/auth/cli/exchange` (device_session) ships the personal
 *      project (id/slug/name/api_key), ensuring the workspace if the approve
 *      path skipped it.
 *   2. `GET /api/auth/cli/personal-project` is the lazy exchange for sessions
 *      minted before 1., and also ensures the workspace.
 *   3. The delivered key REALLY authenticates `GET /api/me/usage`, the
 *      personal-surface read the CLI story hinges on.
 *   4. `POST /api/auth/cli/project-key` resolves a shared project's existing
 *      key by slug for headless `langwatch login --project <slug>`, enforcing
 *      write access and the personal-project ownership rule.
 *
 * The browser normally drives /approve behind a NextAuth session; we stub
 * only that identity (the auth boundary) and let everything else run real.
 *
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ids = vi.hoisted(() => {
  const s = Math.random().toString(36).slice(2, 10);
  return {
    suffix: s,
    USER_ID: `usr-mecred-${s}`,
    EMAIL: `mecred-${s}@example.com`,
    NAME: `MeCred ${s}`,
  };
});

// Only the auth identity is stubbed; the DB/governance calls are real.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { id: ids.USER_ID, email: ids.EMAIL, name: ids.NAME },
  }),
}));
// Write-permission RBAC has its own coverage (auth-cli-personal-guard); here
// it is granted by default and denied per-test to exercise the endpoint gate.
// The approval route reads probeProjectPermission from the app-layer
// imperative module (it moved off ~/server/api/rbac with ADR-092); mocking
// the old path leaves the real check running and the deny test inert.
vi.mock("~/server/app-layer/permissions/imperative", async (importActual) => {
  const actual =
    await importActual<
      typeof import("~/server/app-layer/permissions/imperative")
    >();
  return { ...actual, probeProjectPermission: vi.fn().mockResolvedValue(true) };
});

import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  clearClickHouseTestApp,
  installClickHouseTestApp,
} from "~/test-utils/clickhouseTestApp";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { app as meApp } from "../../../app/api/me/[[...route]]/app";
import { app } from "../auth-cli";

wireDefaultTestApp();

/** The container's connection, handed to the test App the CLI routes read. */
let redisConnection: Redis | null = null;

const suffix = ids.suffix;
const USER_ID = ids.USER_ID;
const ORG_ID = `org-mecred-${suffix}`;
const TEAM_ID = `team-mecred-${suffix}`;
const OTHER_USER_ID = `usr-mecred-other-${suffix}`;
const OTHER_PTEAM_ID = `pteam-mecred-other-${suffix}`;
const SHARED_PROJECT_ID = `proj-mecred-shared-${suffix}`;
const SHARED_PROJECT_SLUG = `mecred-shared-${suffix}`;
const SHARED_API_KEY = `sk-lw-mecred-shared-${suffix}-${"a".repeat(28)}`;
const OTHER_PERSONAL_PROJECT_SLUG = `mecred-personal-other-${suffix}`;
const OTHER_PERSONAL_API_KEY = `sk-lw-mecred-perso-${suffix}-${"b".repeat(28)}`;

interface ExchangeSuccess {
  kind: string;
  access_token: string;
  refresh_token: string;
  personal_project?: {
    id: string;
    slug: string;
    name: string;
    api_key: string;
  };
}

interface DeviceFlowResult {
  approveStatus: number;
  exchangeStatus: number;
  exchange: ExchangeSuccess;
}

/** Run the full device flow: mint, approve (stubbed browser session), exchange. */
async function runDeviceFlow(): Promise<DeviceFlowResult> {
  const dcRes = await app.request("/api/auth/cli/device-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential_type: "device_session" }),
  });
  const dc = (await dcRes.json()) as {
    device_code: string;
    user_code: string;
  };
  const approveRes = await app.request("/api/auth/cli/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_code: dc.user_code,
      organization_id: ORG_ID,
    }),
  });
  const exchangeRes = await app.request("/api/auth/cli/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: dc.device_code }),
  });
  return {
    approveStatus: approveRes.status,
    exchangeStatus: exchangeRes.status,
    exchange: (await exchangeRes.json()) as ExchangeSuccess,
  };
}

async function projectKey(
  accessToken: string,
  slug: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request("/api/auth/cli/project-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ slug }),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** The caller's own org: admin membership, a team, and one shared project. */
async function seedCallerOrg(): Promise<void> {
  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: `MeCred Org ${suffix}`,
      slug: `mecred-${suffix}`,
    },
  });
  await prisma.user.create({
    data: { id: USER_ID, email: ids.EMAIL, name: ids.NAME },
  });
  await prisma.organizationUser.create({
    data: { userId: USER_ID, organizationId: ORG_ID, role: "ADMIN" },
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      name: `MeCred Team ${suffix}`,
      slug: `mecred-team-${suffix}`,
      organizationId: ORG_ID,
    },
  });
  await prisma.teamUser.create({
    data: { userId: USER_ID, teamId: TEAM_ID, role: "ADMIN" },
  });
  await prisma.project.create({
    data: {
      id: SHARED_PROJECT_ID,
      name: `MeCred Shared ${suffix}`,
      slug: SHARED_PROJECT_SLUG,
      apiKey: SHARED_API_KEY,
      teamId: TEAM_ID,
      language: "typescript",
      framework: "openai",
      isPersonal: false,
    },
  });
}

/** Another member's personal workspace: never resolvable by this caller. */
async function seedOtherMemberWorkspace(): Promise<void> {
  await prisma.user.create({
    data: {
      id: OTHER_USER_ID,
      email: `mecred-other-${suffix}@example.com`,
      name: `MeCred Other ${suffix}`,
    },
  });
  await prisma.organizationUser.create({
    data: { userId: OTHER_USER_ID, organizationId: ORG_ID, role: "MEMBER" },
  });
  await prisma.team.create({
    data: {
      id: OTHER_PTEAM_ID,
      name: `MeCred Personal Other ${suffix}`,
      slug: `mecred-pteam-other-${suffix}`,
      organizationId: ORG_ID,
      isPersonal: true,
      ownerUserId: OTHER_USER_ID,
    },
  });
  await prisma.project.create({
    data: {
      id: `proj-mecred-perso-${suffix}`,
      name: `Their Workspace ${suffix}`,
      slug: OTHER_PERSONAL_PROJECT_SLUG,
      apiKey: OTHER_PERSONAL_API_KEY,
      teamId: OTHER_PTEAM_ID,
      language: "typescript",
      framework: "openai",
      isPersonal: true,
      ownerUserId: OTHER_USER_ID,
    },
  });
}

/**
 * A throwaway user holding a live access token seeded straight into Redis, so
 * a test can vary that user's membership around a token that already exists.
 * Keeps the shared admin session untouched.
 */
async function seedUserWithCliToken(args: {
  id: string;
  email: string;
  name: string;
  token: string;
  member?: boolean;
  deactivatedAt?: Date;
}): Promise<void> {
  await prisma.user.create({
    data: {
      id: args.id,
      email: args.email,
      name: args.name,
      deactivatedAt: args.deactivatedAt,
    },
  });
  if (args.member) {
    await prisma.organizationUser.create({
      data: { userId: args.id, organizationId: ORG_ID, role: "MEMBER" },
    });
  }
  const redis = redisConnection!;
  await redis.set(
    `lwcli:access:${args.token}`,
    JSON.stringify({
      user_id: args.id,
      organization_id: ORG_ID,
      issued_at: Date.now(),
      expires_at: Date.now() + 60 * 60 * 1000,
    }),
    "EX",
    3600,
  );
  await redis.sadd(
    `lwcli:user:${args.id}:tokens`,
    `lwcli:access:${args.token}`,
  );
}

const personalTeamCount = (userId: string) =>
  prisma.team.count({
    where: {
      organizationId: ORG_ID,
      ownerUserId: userId,
      isPersonal: true,
    },
  });

let deviceFlow: DeviceFlowResult;
let exchange: ExchangeSuccess;

beforeAll(async () => {
  await startTestContainers();
  redisConnection = getTestRedisConnection();
  // The routes and workers under test take their ClickHouse repositories
  // from the App rather than resolving a client, so the fixture has to
  // provide one or they fail with "App not initialized".
  installClickHouseTestApp({
    resolveClient: async () => getTestClickHouseClient(),
    // The CLI device flow writes its codes and tokens to Redis.
    redis: redisConnection,
  });
  await seedCallerOrg();
  await seedOtherMemberWorkspace();

  // The whole suite hangs off one real device flow, like one real login.
  deviceFlow = await runDeviceFlow();
  exchange = deviceFlow.exchange;
}, 120_000);

afterAll(async () => {
  await clearClickHouseTestApp();
  // organizationId, not principalUserId-in-list: the tenancy guard
  // extension on VirtualKey only honours scalar tenancy predicates; the
  // in-list form is rejected and the catch would hide the leak.
  await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
  const personalTeams = await prisma.team.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true },
  });
  const teamIds = personalTeams.map((t) => t.id);
  await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
  // The device-session exchange mints a user-scoped CLI ApiKey (plus its
  // private custom role); ApiKey→Organization is a Restrict relation, so
  // these must go before the organization delete or it silently no-ops.
  await prisma.apiKey.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.teamUser.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: ORG_ID },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [USER_ID, OTHER_USER_ID] } },
  });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await stopTestContainers().catch(() => {});
});

describe("/me credentials delivery, given a completed device-session exchange", () => {
  /** @scenario device-login exchange delivers the personal project key and the CLI stores it */
  it("ships the personal project with a real api_key", async () => {
    expect(deviceFlow.approveStatus).toBe(200);
    expect(deviceFlow.exchangeStatus).toBe(200);
    expect(exchange.kind).toBe("device_session");
    expect(exchange.personal_project).toBeDefined();
    expect(exchange.personal_project!.api_key).toMatch(/^pkey_/);
    expect(exchange.personal_project!.slug).toContain("personal-");

    const project = await prisma.project.findUnique({
      where: { id: exchange.personal_project!.id },
      select: { isPersonal: true, ownerUserId: true, apiKey: true },
    });
    expect(project?.isPersonal).toBe(true);
    expect(project?.ownerUserId).toBe(USER_ID);
    expect(project?.apiKey).toBe(exchange.personal_project!.api_key);
  });

  /** @scenario the delivered personal key authenticates /api/me/usage */
  it("authenticates GET /api/me/usage with the delivered key", async () => {
    const res = await meApp.request("/api/me/usage", {
      headers: {
        Authorization: `Bearer ${exchange.personal_project!.api_key}`,
        "X-Project-Id": exchange.personal_project!.id,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary?: unknown };
    expect(body.summary).toBeDefined();
  });

  it("identifies the key's project on GET /api/me/project (the notice's name source)", async () => {
    const res = await meApp.request("/api/me/project", {
      headers: {
        Authorization: `Bearer ${exchange.personal_project!.api_key}`,
        "X-Project-Id": exchange.personal_project!.id,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      isPersonal: boolean;
    };
    expect(body.id).toBe(exchange.personal_project!.id);
    expect(body.isPersonal).toBe(true);
    expect(body.name).toBe(exchange.personal_project!.name);
  });
});

describe("/me credentials delivery, given the lazy personal-project exchange", () => {
  /** @scenario a session created before this change lazily exchanges once and rewrites the session file */
  /** @scenario GET /api/auth/cli/personal-project returns the caller's personal project */
  it("returns the same personal project for a valid bearer, idempotently", async () => {
    const res = await app.request("/api/auth/cli/personal-project", {
      headers: { authorization: `Bearer ${exchange.access_token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project: { id: string; api_key: string };
    };
    // ensure() is idempotent: the lazy exchange resolves the SAME workspace
    // the login exchange created, never a duplicate.
    expect(body.project.id).toBe(exchange.personal_project!.id);
    expect(body.project.api_key).toBe(exchange.personal_project!.api_key);
  });

  it("rejects a missing or garbage bearer", async () => {
    const res = await app.request("/api/auth/cli/personal-project", {
      headers: { authorization: "Bearer lw_at_garbage" },
    });
    expect(res.status).toBe(401);
  });
});

describe("/me credentials delivery, given a token whose user is no longer an active org member", () => {
  /** @scenario an offboarded user's pre-removal token cannot mint or return a personal key */
  it("refuses an offboarded user, revokes the token, and creates no workspace", async () => {
    const offboardId = `usr-offboard-${suffix}`;
    const token = `lw_at_offboard${suffix.replace(/[^a-z0-9]/gi, "")}`;
    // Was a member when the token was issued, then removed from the org.
    await seedUserWithCliToken({
      id: offboardId,
      email: `offboard-${suffix}@example.com`,
      name: `Offboard ${suffix}`,
      token,
      member: true,
    });
    await prisma.organizationUser.deleteMany({
      where: { userId: offboardId, organizationId: ORG_ID },
    });

    const before = await personalTeamCount(offboardId);
    const res = await app.request("/api/auth/cli/personal-project", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    // No personal workspace was resurrected in the former tenant.
    expect(await personalTeamCount(offboardId)).toBe(before);
    // The stale session was revoked: its access token is gone from Redis.
    expect(await redisConnection!.get(`lwcli:access:${token}`)).toBeNull();

    // A follow-up call with the same token is now plainly unauthorized.
    const after = await app.request("/api/auth/cli/personal-project", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);

    await prisma.user.deleteMany({ where: { id: offboardId } }).catch(() => {});
  });

  /** @scenario a disabled member's pre-disable token cannot mint or return a personal key */
  it("refuses a member whose seat was disabled, revokes the token, and creates no workspace", async () => {
    const disabledId = `usr-disabled-${suffix}`;
    const token = `lw_at_disabled${suffix.replace(/[^a-z0-9]/gi, "")}`;
    // An active member when the token was issued; an admin then disabled the
    // seat. The row stays, with its role — only the access is gone.
    await seedUserWithCliToken({
      id: disabledId,
      email: `disabled-${suffix}@example.com`,
      name: `Disabled ${suffix}`,
      token,
      member: true,
    });
    await prisma.organizationUser.updateMany({
      where: { userId: disabledId, organizationId: ORG_ID },
      data: { disabledAt: new Date() },
    });

    const before = await personalTeamCount(disabledId);
    const res = await app.request("/api/auth/cli/personal-project", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    expect(await personalTeamCount(disabledId)).toBe(before);
    expect(await redisConnection!.get(`lwcli:access:${token}`)).toBeNull();

    await prisma.organizationUser
      .deleteMany({ where: { userId: disabledId, organizationId: ORG_ID } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: disabledId } }).catch(() => {});
  });

  /** @scenario a deactivated user's token cannot mint or return a personal key */
  it("refuses a deactivated user even while org membership lingers", async () => {
    const deactId = `usr-deact-${suffix}`;
    const token = `lw_at_deact${suffix.replace(/[^a-z0-9]/gi, "")}`;
    await seedUserWithCliToken({
      id: deactId,
      email: `deact-${suffix}@example.com`,
      name: `Deactivated ${suffix}`,
      deactivatedAt: new Date(),
      token,
      member: true,
    });

    const res = await app.request("/api/auth/cli/personal-project", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    expect(await redisConnection!.get(`lwcli:access:${token}`)).toBeNull();

    await prisma.organizationUser
      .deleteMany({ where: { userId: deactId } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: deactId } }).catch(() => {});
  });

  /** @scenario POST /api/auth/cli/project-key applies the same membership boundary */
  it("also refuses /project-key for a non-member, revoking the token", async () => {
    const outsiderId = `usr-outsider-${suffix}`;
    const token = `lw_at_outsider${suffix.replace(/[^a-z0-9]/gi, "")}`;
    // Never a member of ORG_ID.
    await seedUserWithCliToken({
      id: outsiderId,
      email: `outsider-${suffix}@example.com`,
      name: `Outsider ${suffix}`,
      token,
    });

    const { status } = await projectKey(token, SHARED_PROJECT_SLUG);

    expect(status).toBe(403);
    expect(await redisConnection!.get(`lwcli:access:${token}`)).toBeNull();

    await prisma.user.deleteMany({ where: { id: outsiderId } }).catch(() => {});
  });
});

describe("/me credentials delivery, given POST /api/auth/cli/project-key (headless --project <slug>)", () => {
  /** @scenario `langwatch login --project <slug>` resolves the key through the device session, no browser */
  it("returns the shared project's existing key by slug", async () => {
    const { status, json } = await projectKey(
      exchange.access_token,
      SHARED_PROJECT_SLUG,
    );

    expect(status).toBe(200);
    expect(json.api_key).toBe(SHARED_API_KEY);
    expect((json.project as { id: string }).id).toBe(SHARED_PROJECT_ID);
  });

  /** @scenario the project-key endpoint refuses another user's personal project */
  /** @scenario the server still refuses a personal project that is not the caller's own */
  it("refuses another user's personal project outright", async () => {
    const { status, json } = await projectKey(
      exchange.access_token,
      OTHER_PERSONAL_PROJECT_SLUG,
    );

    expect(status).toBe(400);
    expect(json.error).toBe("personal_project_not_allowed");
    expect(JSON.stringify(json)).not.toContain(OTHER_PERSONAL_API_KEY);
  });

  /** @scenario the project-key endpoint returns the caller's own personal project key */
  it("returns the caller's own personal project by slug", async () => {
    const { status, json } = await projectKey(
      exchange.access_token,
      exchange.personal_project!.slug,
    );

    expect(status).toBe(200);
    expect(json.api_key).toBe(exchange.personal_project!.api_key);
  });

  /** @scenario the project-key endpoint refuses a project the caller cannot write to */
  it("denies a project the caller cannot write, without leaking the key", async () => {
    vi.mocked(probeProjectPermission).mockResolvedValueOnce(false);

    const { status, json } = await projectKey(
      exchange.access_token,
      SHARED_PROJECT_SLUG,
    );

    expect(status).toBe(403);
    expect(JSON.stringify(json)).not.toContain(SHARED_API_KEY);
  });

  it("404s an unknown slug with an error envelope the CLI can distinguish", async () => {
    const { status, json } = await projectKey(
      exchange.access_token,
      `mecred-nope-${suffix}`,
    );

    expect(status).toBe(404);
    expect(json.error).toBe("not_found");
  });

  it("rejects a missing bearer", async () => {
    const res = await app.request("/api/auth/cli/project-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: SHARED_PROJECT_SLUG }),
    });
    expect(res.status).toBe(401);
  });
});
