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
import { z } from "zod";

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

import { CLI_PROJECT_KEY_NAME_PREFIX } from "~/server/api-key/reserved-names";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
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

const exchangeSuccessSchema = z
  .object({
    kind: z.string(),
    access_token: z.string(),
    refresh_token: z.string(),
    personal_project: z
      .object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        api_key: z.string(),
      })
      .optional(),
  })
  .passthrough();
const personalProjectResponseSchema = z
  .object({
    project: z
      .object({ id: z.string(), api_key: z.string().optional() })
      .passthrough(),
  })
  .passthrough();
type ExchangeSuccess = z.infer<typeof exchangeSuccessSchema>;

interface DeviceFlowResult {
  approveStatus: number;
  exchangeStatus: number;
  exchange: ExchangeSuccess;
}

/**
 * Run the full device flow: mint, approve (stubbed browser session), exchange.
 * A login from the same device replaces the previous session's login key, so
 * a flow that must leave the suite's main session alone names its own device.
 */
async function runDeviceFlow({
  deviceLabel,
}: {
  deviceLabel?: string;
} = {}): Promise<DeviceFlowResult> {
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
    body: JSON.stringify({
      device_code: dc.device_code,
      ...(deviceLabel ? { client_info: { device_label: deviceLabel } } : {}),
    }),
  });
  return {
    approveStatus: approveRes.status,
    exchangeStatus: exchangeRes.status,
    exchange: exchangeSuccessSchema.parse(await exchangeRes.json()),
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
  // The handed-out keys are capped by the person's own access, so the caller
  // holds the organization ADMIN binding an org admin really has.
  await seedRoleBinding(prisma, {
    id: `rb-mecred-admin-${suffix}`,
    organizationId: ORG_ID,
    userId: USER_ID,
    role: "ADMIN",
    scopeType: "ORGANIZATION",
    scopeId: ORG_ID,
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

/** The project a token authenticates as when the request names none. */
async function projectOfToken(token: string): Promise<string | null> {
  const resolved = await TokenResolver.create(prisma).resolve({
    token,
    projectId: null,
  });
  return resolved?.project.id ?? null;
}

/** Every string and set member in the test Redis, to look for a stored secret. */
async function allRedisValues(): Promise<string> {
  const redis = redisConnection!;
  const keys = await redis.keys("*");
  const values: string[] = [];
  for (const key of keys) {
    const type = await redis.type(key);
    if (type === "string") values.push((await redis.get(key)) ?? "");
    if (type === "set") values.push(...(await redis.smembers(key)));
  }
  return values.join("\n");
}

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
    // Minting the login key and the project keys writes grants.
    eventSourcing: createAuthzTestEventSourcing(prisma),
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
  await prisma.grant.deleteMany({ where: { organizationId: ORG_ID } });
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
  it("ships the personal project with an API key of the person's own", async () => {
    expect(deviceFlow.approveStatus).toBe(200);
    expect(deviceFlow.exchangeStatus).toBe(200);
    expect(exchange.kind).toBe("device_session");
    expect(exchange.personal_project).toBeDefined();
    expect(exchange.personal_project!.api_key).toMatch(/^sk-lw-[A-Za-z0-9]+_/);
    expect(exchange.personal_project!.slug).toContain("personal-");

    const project = await prisma.project.findUnique({
      where: { id: exchange.personal_project!.id },
      select: { isPersonal: true, ownerUserId: true, apiKey: true },
    });
    expect(project?.isPersonal).toBe(true);
    expect(project?.ownerUserId).toBe(USER_ID);
    // The project API key itself is stored as a hash only.
    expect(project?.apiKey).toBeNull();
  });

  /** @scenario the key a CLI login hands out is the person's own, bound to the one project */
  it("mints the key for the person, bound to the project, under the session's login key", async () => {
    const loginKey = await prisma.apiKey.findFirst({
      where: {
        organizationId: ORG_ID,
        userId: USER_ID,
        name: { startsWith: "CLI login - " },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const keys = await prisma.apiKey.findMany({
      where: {
        organizationId: ORG_ID,
        userId: USER_ID,
        name: { startsWith: CLI_PROJECT_KEY_NAME_PREFIX },
        parentApiKeyId: loginKey!.id,
      },
      select: { id: true, permissionMode: true },
    });
    expect(keys).toHaveLength(1);
    expect(keys[0]!.permissionMode).toBe("all");
    const bindings = await prisma.roleBinding.findMany({
      where: { organizationId: ORG_ID, apiKeyId: keys[0]!.id },
      select: { role: true, scopeType: true, scopeId: true },
    });
    expect(bindings).toEqual([
      {
        role: "ADMIN",
        scopeType: "PROJECT",
        scopeId: exchange.personal_project!.id,
      },
    ]);
  });

  /** @scenario the handed-out key authenticates as its project without a project header */
  it("authenticates as the personal project without naming it", async () => {
    await expect(
      projectOfToken(exchange.personal_project!.api_key),
    ).resolves.toBe(exchange.personal_project!.id);
  });

  /** @scenario no plaintext key is stored with the device login */
  it("stores no handed-out key in plaintext in Redis", async () => {
    const values = await allRedisValues();
    expect(values).not.toContain(exchange.personal_project!.api_key);
  });

  /** @scenario device-login exchange stays valid when the personal project key is withheld */
  it("keeps the device login successful when project administration is absent", async () => {
    vi.mocked(probeProjectPermission).mockResolvedValueOnce(false);
    const flow = await runDeviceFlow({ deviceLabel: "other-laptop" });
    expect(flow.approveStatus).toBe(200);
    expect(flow.exchangeStatus).toBe(200);
    expect(flow.exchange.kind).toBe("device_session");
    expect(flow.exchange.personal_project).toBeUndefined();
    expect(flow.exchange.access_token).toMatch(/^lw_at_/);
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
    const body = personalProjectResponseSchema.parse(await res.json());
    // ensure() is idempotent: the lazy exchange resolves the SAME workspace
    // the login exchange created, never a duplicate.
    expect(body.project.id).toBe(exchange.personal_project!.id);
    // The session's key is re-sent, not minted again on every check.
    expect(body.project.api_key).toBe(exchange.personal_project!.api_key);
  });

  /** @scenario GET /api/auth/cli/personal-project withholds the key without breaking the session */
  it("returns project identity without api_key and leaves the bearer valid", async () => {
    vi.mocked(probeProjectPermission).mockResolvedValueOnce(false);
    const res = await app.request("/api/auth/cli/personal-project", {
      headers: { authorization: `Bearer ${exchange.access_token}` },
    });
    expect(res.status).toBe(200);
    const body = personalProjectResponseSchema.parse(await res.json());
    expect(body.project.id).toBe(exchange.personal_project!.id);
    expect(body.project.api_key).toBeUndefined();
    await expect(
      redisConnection!.get(`lwcli:access:${exchange.access_token}`),
    ).resolves.not.toBeNull();
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
  it("refuses a member whose seat was disabled, revokes the token, and creates nothing", async () => {
    const disabledId = `usr-disabled-${suffix}`;
    const token = `lw_at_disabled${suffix.replace(/[^a-z0-9]/gi, "")}`;
    // Everything the scenario says must not appear: the personal team, its
    // project, and any role binding in the tenant.
    const provisioned = async () => ({
      teams: await personalTeamCount(disabledId),
      projects: await prisma.project.count({
        where: {
          team: { organizationId: ORG_ID },
          ownerUserId: disabledId,
          isPersonal: true,
        },
      }),
      bindings: await prisma.roleBinding.count({
        where: { organizationId: ORG_ID, userId: disabledId },
      }),
    });

    try {
      // An active member when the token was issued; an admin then disabled
      // the seat. The row stays, with its role — only the access is gone.
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
      const before = await provisioned();

      const res = await app.request("/api/auth/cli/personal-project", {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      expect(await provisioned()).toEqual(before);
      expect(await redisConnection!.get(`lwcli:access:${token}`)).toBeNull();
    } finally {
      await prisma.organizationUser.deleteMany({
        where: { userId: disabledId, organizationId: ORG_ID },
      });
      await prisma.user.deleteMany({ where: { id: disabledId } });
    }
  });

  /** @scenario a disabled member's session cannot be renewed */
  it("refuses to rotate a disabled member's refresh token, and revokes it", async () => {
    // A session started while active; the seat is disabled afterwards.
    // Rotation mints a new pair, so it re-derives membership like every
    // other minting endpoint — otherwise the hour-long access token would
    // roll forward for ninety days.
    const flow = await runDeviceFlow({ deviceLabel: "other-laptop" });
    expect(flow.exchangeStatus).toBe(200);
    const refreshToken = flow.exchange.refresh_token;

    await prisma.organizationUser.updateMany({
      where: { userId: USER_ID, organizationId: ORG_ID },
      data: { disabledAt: new Date() },
    });
    try {
      const res = await app.request("/api/auth/cli/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_grant");
      expect(body.access_token).toBeUndefined();
      expect(
        await redisConnection!.get(`lwcli:refresh:${refreshToken}`),
      ).toBeNull();
    } finally {
      await prisma.organizationUser.updateMany({
        where: { userId: USER_ID, organizationId: ORG_ID },
        data: { disabledAt: null },
      });
    }
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
  it("returns a key of the person's own for the shared project by slug", async () => {
    const { status, json } = await projectKey(
      exchange.access_token,
      SHARED_PROJECT_SLUG,
    );

    expect(status).toBe(200);
    expect(json.api_key).not.toBe(SHARED_API_KEY);
    expect((json.project as { id: string }).id).toBe(SHARED_PROJECT_ID);
    await expect(projectOfToken(json.api_key as string)).resolves.toBe(
      SHARED_PROJECT_ID,
    );
  });

  /** @scenario asking again for the same project re-sends the key instead of minting another */
  it("re-sends the same key to the same device", async () => {
    const first = await projectKey(exchange.access_token, SHARED_PROJECT_SLUG);
    const second = await projectKey(exchange.access_token, SHARED_PROJECT_SLUG);

    expect(second.json.api_key).toBe(first.json.api_key);
    expect(await allRedisValues()).not.toContain(first.json.api_key as string);
  });

  /** @scenario a key revoked from the API keys page is never re-sent */
  it("mints a new key once the held one was revoked", async () => {
    const first = await projectKey(exchange.access_token, SHARED_PROJECT_SLUG);
    await prisma.apiKey.updateMany({
      where: {
        organizationId: ORG_ID,
        userId: USER_ID,
        name: { startsWith: CLI_PROJECT_KEY_NAME_PREFIX },
        parentApiKeyId: null,
      },
      data: { revokedAt: new Date() },
    });

    const second = await projectKey(exchange.access_token, SHARED_PROJECT_SLUG);

    expect(second.status).toBe(200);
    expect(second.json.api_key).not.toBe(first.json.api_key);
    await expect(projectOfToken(second.json.api_key as string)).resolves.toBe(
      SHARED_PROJECT_ID,
    );
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
    await expect(projectOfToken(json.api_key as string)).resolves.toBe(
      exchange.personal_project!.id,
    );
  });

  /** @scenario the project-key endpoint refuses a project the caller cannot manage */
  it("denies a project the caller cannot manage, without leaking the key", async () => {
    vi.mocked(probeProjectPermission).mockResolvedValueOnce(false);

    const { status, json } = await projectKey(
      exchange.access_token,
      SHARED_PROJECT_SLUG,
    );

    expect(status).toBe(403);
    expect(JSON.stringify(json)).not.toContain(SHARED_API_KEY);
    expect(probeProjectPermission).toHaveBeenLastCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          user: expect.objectContaining({ id: USER_ID }),
        }),
      }),
      SHARED_PROJECT_ID,
      "project:manage",
    );
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

describe("/me credentials delivery, given a new login from the same device", () => {
  /** @scenario a new login from the same device retires the previous session's project key */
  it("retires the previous session's personal project key", async () => {
    const previousKey = exchange.personal_project!.api_key;
    await expect(projectOfToken(previousKey)).resolves.toBe(
      exchange.personal_project!.id,
    );

    const next = await runDeviceFlow();

    expect(next.exchangeStatus).toBe(200);
    expect(next.exchange.personal_project!.api_key).not.toBe(previousKey);
    await expect(projectOfToken(previousKey)).resolves.toBeNull();
    // Revoked with the login key it was minted under, not only refused.
    const sessionKeys = await prisma.apiKey.findMany({
      where: {
        organizationId: ORG_ID,
        userId: USER_ID,
        name: { startsWith: CLI_PROJECT_KEY_NAME_PREFIX },
        parentApiKeyId: { not: null },
        createdByDeviceLabel: "unknown-device",
      },
      select: { revokedAt: true, revocationCause: true },
      orderBy: { createdAt: "asc" },
    });
    expect(sessionKeys[0]).toEqual({
      revokedAt: expect.any(Date),
      revocationCause: "rotation",
    });
    await expect(
      projectOfToken(next.exchange.personal_project!.api_key),
    ).resolves.toBe(exchange.personal_project!.id);
  });

  /** @scenario a superseded session gets no key for its personal project */
  it("hands the superseded session no key", async () => {
    const res = await app.request("/api/auth/cli/personal-project", {
      headers: { authorization: `Bearer ${exchange.access_token}` },
    });

    expect(res.status).toBe(200);
    const body = personalProjectResponseSchema.parse(await res.json());
    expect(body.project.id).toBe(exchange.personal_project!.id);
    expect(body.project.api_key).toBeUndefined();
  });
});
