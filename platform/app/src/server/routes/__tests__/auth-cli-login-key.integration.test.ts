/**
 * @vitest-environment node
 *
 * Integration coverage for the user-scoped CLI login key: the device-session
 * approval stamps a scope + permission selection (explicit or server-side
 * default), /exchange mints a `restricted` ApiKey owned by the approving
 * user, re-login replaces it, and /logout revokes it. Real Redis + real
 * Postgres; only the NextAuth session identity is stubbed.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({
  current: { id: "unset", email: "unset@example.com", name: "Unset" },
}));

// Only the auth identity is stubbed; everything else runs real.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => ({ user: identity.current })),
}));

import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  CLI_KEY_DEFAULT_EXCLUDED_PERMISSIONS,
  defaultCliKeyPermissions,
} from "@langwatch/api-key-contract";
import { getApp } from "~/server/app-layer/app";
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
import { app as projectsApp } from "../../../app/api/projects/[[...route]]/app";
import { app as tracesApp } from "../../../app/api/traces/[[...route]]/app";
import { app } from "../auth-cli";

// Device labels are normalized server-side to [a-z0-9-]; keeping the suffix
// in that charset means the fixture hostname IS the stored label.
const suffix = nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "0");

const ORG_ID = `org-clikey-${suffix}`;
const ADMIN_ID = `usr-clikey-admin-${suffix}`;
const MEMBER_ID = `usr-clikey-member-${suffix}`;
const CEILING_ID = `usr-clikey-ceiling-${suffix}`;
const TEAM_SHARED_ID = `team-clikey-shared-${suffix}`;
const TEAM_OTHER_ID = `team-clikey-other-${suffix}`;
const MEMBER_PTEAM_ID = `pteam-clikey-member-${suffix}`;
const PROJECT_A_ID = `proj-clikey-a-${suffix}`;
const PROJECT_B_ID = `proj-clikey-b-${suffix}`;
const MEMBER_PPROJECT_ID = `proj-clikey-personal-${suffix}`;

let redisConnection: Redis | null = null;

type IdentityUser = { id: string; email: string; name: string };

const adminUser: IdentityUser = {
  id: ADMIN_ID,
  email: `clikey-admin-${suffix}@example.com`,
  name: `CliKey Admin ${suffix}`,
};
const memberUser: IdentityUser = {
  id: MEMBER_ID,
  email: `clikey-member-${suffix}@example.com`,
  name: `CliKey Member ${suffix}`,
};
const ceilingUser: IdentityUser = {
  id: CEILING_ID,
  email: `clikey-ceiling-${suffix}@example.com`,
  name: `CliKey Ceiling ${suffix}`,
};

interface KeySelectionBody {
  bindings: Array<{ scope_type: string; scope_id: string }>;
  permissions: string[];
}

interface ExchangeSuccess {
  kind: string;
  access_token: string;
  refresh_token: string;
  personal_project?: { id: string; api_key: string };
  cli_api_key?: string;
  cli_api_key_scope?: { kind: string; project_ids: string[] };
}

async function mintDeviceCode(): Promise<{
  device_code: string;
  user_code: string;
}> {
  const res = await app.request("/api/auth/cli/device-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential_type: "device_session" }),
  });
  return (await res.json()) as { device_code: string; user_code: string };
}

async function approve({
  userCode,
  keySelection,
}: {
  userCode: string;
  keySelection?: KeySelectionBody;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request("/api/auth/cli/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_code: userCode,
      organization_id: ORG_ID,
      ...(keySelection ? { key_selection: keySelection } : {}),
    }),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

async function exchange({
  deviceCode,
  hostname,
}: {
  deviceCode: string;
  hostname: string;
}): Promise<{ status: number; json: ExchangeSuccess }> {
  const res = await app.request("/api/auth/cli/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_code: deviceCode,
      client_info: { hostname, platform: "darwin" },
    }),
  });
  return { status: res.status, json: (await res.json()) as ExchangeSuccess };
}

/**
 * Full device flow as the current identity: mint, approve, exchange.
 *
 * A failed step throws with the body the server answered, rather than
 * asserting: the assertion belongs to the test, and a helper that swallows a
 * 403 into a bare "expected 403 to be 200" hides why it was refused.
 */
async function runFlow(args: {
  as: IdentityUser;
  hostname: string;
  keySelection?: KeySelectionBody;
}): Promise<ExchangeSuccess> {
  identity.current = args.as;
  const dc = await mintDeviceCode();
  const approved = await approve({
    userCode: dc.user_code,
    keySelection: args.keySelection,
  });
  if (approved.status !== 200) {
    throw new Error(
      `approve answered ${approved.status}: ${JSON.stringify(approved.json)}`,
    );
  }
  const exchanged = await exchange({
    deviceCode: dc.device_code,
    hostname: args.hostname,
  });
  if (exchanged.status !== 200) {
    throw new Error(
      `exchange answered ${exchanged.status}: ${JSON.stringify(exchanged.json)}`,
    );
  }
  return exchanged.json;
}

async function mintedKeyFor({
  userId,
  deviceLabel,
}: {
  userId: string;
  deviceLabel: string;
}) {
  return prisma.apiKey.findFirst({
    where: {
      organizationId: ORG_ID,
      userId,
      createdByDeviceLabel: deviceLabel,
      revokedAt: null,
    },
    include: { roleBindings: true },
  });
}

/** The explicit permission list behind a restricted key's custom role. */
async function keyPermissions(apiKeyId: string): Promise<string[]> {
  const key = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, organizationId: ORG_ID },
    include: { roleBindings: true },
  });
  const customRoleIds = [
    ...new Set(
      (key?.roleBindings ?? [])
        .map((binding) => binding.customRoleId)
        .filter((id): id is string => !!id),
    ),
  ];
  const roles = await prisma.customRole.findMany({
    where: { id: { in: customRoleIds }, organizationId: ORG_ID },
    select: { permissions: true },
  });
  return [
    ...new Set(
      roles.flatMap((role) =>
        Array.isArray(role.permissions) ? (role.permissions as string[]) : [],
      ),
    ),
  ].sort();
}

beforeAll(async () => {
  await startTestContainers();
  redisConnection = getTestRedisConnection();
  installClickHouseTestApp({
    resolveClient: async () => getTestClickHouseClient(),
    redis: redisConnection,
  });

  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: `CliKey Org ${suffix}`,
      slug: `clikey-${suffix}`,
    },
  });
  for (const user of [adminUser, memberUser, ceilingUser]) {
    await prisma.user.create({
      data: { id: user.id, email: user.email, name: user.name },
    });
  }
  await prisma.organizationUser.createMany({
    data: [
      { userId: ADMIN_ID, organizationId: ORG_ID, role: "ADMIN" },
      { userId: MEMBER_ID, organizationId: ORG_ID, role: "MEMBER" },
      { userId: CEILING_ID, organizationId: ORG_ID, role: "ADMIN" },
    ],
  });
  await prisma.team.createMany({
    data: [
      {
        id: TEAM_SHARED_ID,
        name: `CliKey Shared ${suffix}`,
        slug: `clikey-shared-${suffix}`,
        organizationId: ORG_ID,
      },
      {
        id: TEAM_OTHER_ID,
        name: `CliKey Other ${suffix}`,
        slug: `clikey-other-${suffix}`,
        organizationId: ORG_ID,
      },
      {
        id: MEMBER_PTEAM_ID,
        name: `CliKey Personal ${suffix}`,
        slug: `clikey-pteam-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: MEMBER_ID,
      },
    ],
  });
  await prisma.project.createMany({
    data: [
      {
        id: PROJECT_A_ID,
        name: `CliKey Project A ${suffix}`,
        slug: `clikey-a-${suffix}`,
        apiKey: `test-clikey-a-${suffix}`,
        teamId: TEAM_SHARED_ID,
        language: "typescript",
        framework: "openai",
      },
      {
        id: PROJECT_B_ID,
        name: `CliKey Project B ${suffix}`,
        slug: `clikey-b-${suffix}`,
        apiKey: `test-clikey-b-${suffix}`,
        teamId: TEAM_OTHER_ID,
        language: "typescript",
        framework: "openai",
      },
      {
        id: MEMBER_PPROJECT_ID,
        name: `CliKey Personal Project ${suffix}`,
        slug: `clikey-personal-${suffix}`,
        apiKey: `test-clikey-personal-${suffix}`,
        teamId: MEMBER_PTEAM_ID,
        language: "typescript",
        framework: "openai",
        isPersonal: true,
        ownerUserId: MEMBER_ID,
      },
    ],
  });
  await prisma.teamUser.createMany({
    data: [
      { userId: MEMBER_ID, teamId: TEAM_SHARED_ID, role: TeamUserRole.ADMIN },
      { userId: MEMBER_ID, teamId: MEMBER_PTEAM_ID, role: TeamUserRole.ADMIN },
    ],
  });
  // Role bindings decide the ceiling: org-scope ADMIN for the two admins,
  // team-scope ADMIN for the member (shared team + their personal team, the
  // latter seeded directly so the default-selection path is deterministic
  // rather than racing the personal-workspace grant projection).
  await prisma.roleBinding.createMany({
    data: [
      {
        id: `rb-clikey-admin-${suffix}`,
        organizationId: ORG_ID,
        userId: ADMIN_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
      {
        id: `rb-clikey-ceiling-${suffix}`,
        organizationId: ORG_ID,
        userId: CEILING_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
      {
        id: `rb-clikey-member-shared-${suffix}`,
        organizationId: ORG_ID,
        userId: MEMBER_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: TEAM_SHARED_ID,
      },
      {
        id: `rb-clikey-member-personal-${suffix}`,
        organizationId: ORG_ID,
        userId: MEMBER_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: MEMBER_PTEAM_ID,
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  await clearClickHouseTestApp();
  await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.apiKey.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } });
  const teams = await prisma.team.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true },
  });
  const teamIds = teams.map((team) => team.id);
  await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.teamUser.deleteMany({ where: { teamId: { in: teamIds } } });
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: ORG_ID },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_ID, MEMBER_ID, CEILING_ID] } },
  });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await stopTestContainers().catch(() => {});
});

describe("CLI login user-scoped key, given a device-session flow", () => {
  describe("when an org admin approves with no explicit selection and the CLI exchanges", () => {
    const HOSTNAME = `admin-default-${suffix}`;
    let result: ExchangeSuccess;

    beforeAll(async () => {
      result = await runFlow({ as: adminUser, hostname: HOSTNAME });
    }, 60_000);

    /** @scenario "exchange returns a user-owned scoped key" */
    it("returns a user-owned restricted key beside the unchanged personal project", async () => {
      expect(result.kind).toBe("device_session");
      expect(result.cli_api_key).toMatch(/^sk-lw-.+_.+$/);
      // Older CLI versions keep working unchanged.
      expect(result.personal_project).toBeDefined();
      expect(result.access_token).toMatch(/^lw_at_/);

      const key = await mintedKeyFor({
        userId: ADMIN_ID,
        deviceLabel: HOSTNAME,
      });
      expect(key).not.toBeNull();
      expect(key!.userId).toBe(ADMIN_ID);
      expect(key!.permissionMode).toBe("restricted");
      const permissions = await keyPermissions(key!.id);
      expect(permissions).toEqual([...defaultCliKeyPermissions()].sort());
    });

    /** @scenario "org admin defaults to organization scope" */
    it("binds the default key to the whole organization", async () => {
      const key = await mintedKeyFor({
        userId: ADMIN_ID,
        deviceLabel: HOSTNAME,
      });
      expect(key!.roleBindings).toHaveLength(1);
      expect(key!.roleBindings[0]!.scopeType).toBe("ORGANIZATION");
      expect(key!.roleBindings[0]!.scopeId).toBe(ORG_ID);
      expect(result.cli_api_key_scope).toEqual({
        kind: "organization",
        project_ids: [],
      });
    });

    /** @scenario "the organization-management permissions are off by default" */
    it("excludes the organization-management set and keeps gateway + project:manage", async () => {
      const key = await mintedKeyFor({
        userId: ADMIN_ID,
        deviceLabel: HOSTNAME,
      });
      const permissions = await keyPermissions(key!.id);
      for (const excluded of CLI_KEY_DEFAULT_EXCLUDED_PERMISSIONS) {
        expect(permissions).not.toContain(excluded);
      }
      expect(permissions).toContain("project:manage");
      expect(permissions).toContain("virtualKeys:view");
      expect(permissions).toContain("gatewayBudgets:view");
      expect(permissions).toContain("gatewayProviders:view");
      expect(permissions).toContain("routingPolicies:view");
    });
  });

  describe("when a regular member approves with no explicit selection", () => {
    const HOSTNAME = `member-default-${suffix}`;
    let result: ExchangeSuccess;

    beforeAll(async () => {
      result = await runFlow({ as: memberUser, hostname: HOSTNAME });
    }, 60_000);

    /** @scenario "regular member defaults to their own teams plus personal workspace" */
    it("binds the default key to the member's teams and personal workspace, never the org", async () => {
      const key = await mintedKeyFor({
        userId: MEMBER_ID,
        deviceLabel: HOSTNAME,
      });
      expect(key).not.toBeNull();
      const scopes = key!.roleBindings
        .map((binding) => `${binding.scopeType}:${binding.scopeId}`)
        .sort();
      expect(scopes).toEqual(
        [`TEAM:${TEAM_SHARED_ID}`, `TEAM:${MEMBER_PTEAM_ID}`].sort(),
      );
      expect(result.cli_api_key_scope!.kind).toBe("projects");
      expect([...result.cli_api_key_scope!.project_ids].sort()).toEqual(
        [PROJECT_A_ID, MEMBER_PPROJECT_ID].sort(),
      );
    });
  });

  describe("when the user narrows the selection to one project, read only", () => {
    const HOSTNAME = `member-narrow-${suffix}`;
    let result: ExchangeSuccess;

    beforeAll(async () => {
      result = await runFlow({
        as: memberUser,
        hostname: HOSTNAME,
        keySelection: {
          bindings: [{ scope_type: "PROJECT", scope_id: PROJECT_A_ID }],
          permissions: ["traces:view"],
        },
      });
    }, 60_000);

    /** @scenario "narrowing the selection narrows the minted key" */
    it("mints exactly one PROJECT binding carrying traces:view and nothing wider", async () => {
      const key = await mintedKeyFor({
        userId: MEMBER_ID,
        deviceLabel: HOSTNAME,
      });
      expect(key).not.toBeNull();
      expect(key!.roleBindings).toHaveLength(1);
      expect(key!.roleBindings[0]!.scopeType).toBe("PROJECT");
      expect(key!.roleBindings[0]!.scopeId).toBe(PROJECT_A_ID);
      const permissions = await keyPermissions(key!.id);
      expect(permissions).toContain("traces:view");
      expect(permissions).not.toContain("traces:update");
      expect(result.cli_api_key_scope).toEqual({
        kind: "projects",
        project_ids: [PROJECT_A_ID],
      });
    });
  });

  describe("when an approve request carries zero bindings", () => {
    /** @scenario "approval with zero scopes selected is refused" */
    it("refuses with a handled error naming the bindings field and stamps nothing", async () => {
      identity.current = memberUser;
      const dc = await mintDeviceCode();
      const before = await prisma.apiKey.count({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });

      const refused = await approve({
        userCode: dc.user_code,
        keySelection: {
          bindings: [],
          permissions: ["traces:view"],
        },
      });

      expect(refused.status).toBe(422);
      expect(refused.json.error).toBe("cli_key_selection_invalid");
      expect(
        (refused.json.fieldErrors as Record<string, unknown>).bindings,
      ).toBeDefined();

      const raw = await redisConnection!.get(`lwcli:device:${dc.device_code}`);
      const record = JSON.parse(raw!) as {
        status: string;
        key_selection?: unknown;
      };
      expect(record.status).toBe("pending");
      expect(record.key_selection).toBeUndefined();
      expect(
        await prisma.apiKey.count({
          where: { organizationId: ORG_ID, userId: MEMBER_ID },
        }),
      ).toBe(before);
    });
  });

  describe("when a member claims an organization-wide binding", () => {
    /** @scenario "approve refuses bindings above the approving user's ceiling" */
    it("refuses the approval and leaves the device code pending, selection unstamped", async () => {
      identity.current = memberUser;
      const dc = await mintDeviceCode();

      const refused = await approve({
        userCode: dc.user_code,
        keySelection: {
          bindings: [{ scope_type: "ORGANIZATION", scope_id: ORG_ID }],
          permissions: ["traces:view"],
        },
      });

      expect(refused.status).toBe(403);
      expect(refused.json.error).toBe("api_key_scope_violation");

      const raw = await redisConnection!.get(`lwcli:device:${dc.device_code}`);
      const record = JSON.parse(raw!) as {
        status: string;
        key_selection?: unknown;
      };
      expect(record.status).toBe("pending");
      expect(record.key_selection).toBeUndefined();
    });
  });

  describe("when an approval is never exchanged", () => {
    /** @scenario "an approval that is never exchanged mints nothing" */
    it("creates no ApiKey row for the login", async () => {
      identity.current = adminUser;
      const before = await prisma.apiKey.count({
        where: { organizationId: ORG_ID, userId: ADMIN_ID },
      });

      const dc = await mintDeviceCode();
      const approved = await approve({ userCode: dc.user_code });
      expect(approved.status).toBe(200);

      // The selection is stamped on the Redis record and nowhere else.
      const raw = await redisConnection!.get(`lwcli:device:${dc.device_code}`);
      const record = JSON.parse(raw!) as {
        status: string;
        key_selection?: unknown;
      };
      expect(record.status).toBe("approved");
      expect(record.key_selection).toBeDefined();

      expect(
        await prisma.apiKey.count({
          where: { organizationId: ORG_ID, userId: ADMIN_ID },
        }),
      ).toBe(before);
    });
  });

  describe("when the user logs in again from the same device", () => {
    /** @scenario "re-login from the same device replaces the previous CLI key" */
    it("revokes the previous key and leaves exactly one active for the device label", async () => {
      const HOSTNAME = `relogin-${suffix}`;
      const first = await runFlow({ as: memberUser, hostname: HOSTNAME });
      const firstKey = await mintedKeyFor({
        userId: MEMBER_ID,
        deviceLabel: HOSTNAME,
      });
      expect(firstKey).not.toBeNull();

      const second = await runFlow({ as: memberUser, hostname: HOSTNAME });
      expect(second.cli_api_key).toBeDefined();
      expect(second.cli_api_key).not.toBe(first.cli_api_key);

      const firstAfter = await prisma.apiKey.findFirst({
        where: { id: firstKey!.id, organizationId: ORG_ID },
        select: { revokedAt: true },
      });
      expect(firstAfter!.revokedAt).not.toBeNull();

      const active = await prisma.apiKey.count({
        where: {
          organizationId: ORG_ID,
          userId: MEMBER_ID,
          createdByDeviceLabel: HOSTNAME,
          revokedAt: null,
        },
      });
      expect(active).toBe(1);
    });
  });

  describe("when two logins for one device label are exchanged at the same time", () => {
    /** @scenario "two logins racing on one device leave the newer key alive" */
    it("revokes only the keys older than each mint, so the newest survives", async () => {
      const HOSTNAME = `race-${suffix}`;
      const first = await runFlow({ as: memberUser, hostname: HOSTNAME });
      const firstKey = await prisma.apiKey.findFirst({
        where: {
          organizationId: ORG_ID,
          userId: MEMBER_ID,
          createdByDeviceLabel: HOSTNAME,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      });
      expect(firstKey).not.toBeNull();

      const second = await runFlow({ as: memberUser, hostname: HOSTNAME });
      expect(second.cli_api_key).not.toBe(first.cli_api_key);
      const secondKey = await mintedKeyFor({
        userId: MEMBER_ID,
        deviceLabel: HOSTNAME,
      });
      expect(secondKey).not.toBeNull();

      // The first exchange's revoke, arriving after the second mint already
      // landed — the interleaving the race produces. Excluding only its own
      // key is not enough; without the createdBefore bound it would revoke
      // the key the second exchange just handed to the CLI.
      await getApp().apiKeys.revokeCliLoginKeysForDevice({
        userId: MEMBER_ID,
        organizationId: ORG_ID,
        deviceLabel: HOSTNAME,
        exceptApiKeyId: firstKey!.id,
        createdBefore: firstKey!.createdAt,
      });

      const secondAfter = await prisma.apiKey.findFirst({
        where: { id: secondKey!.id, organizationId: ORG_ID },
        select: { revokedAt: true },
      });
      expect(secondAfter!.revokedAt).toBeNull();
    });
  });

  describe("when the CLI calls the logout endpoint", () => {
    /** @scenario "logout revokes the CLI key" */
    it("revokes the login key along with the session tokens", async () => {
      const HOSTNAME = `logout-${suffix}`;
      const result = await runFlow({ as: memberUser, hostname: HOSTNAME });
      const key = await mintedKeyFor({
        userId: MEMBER_ID,
        deviceLabel: HOSTNAME,
      });
      expect(key).not.toBeNull();

      const res = await app.request("/api/auth/cli/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refresh_token: result.refresh_token,
          access_token: result.access_token,
        }),
      });
      expect(res.status).toBe(200);

      const after = await prisma.apiKey.findFirst({
        where: { id: key!.id, organizationId: ORG_ID },
        select: { revokedAt: true },
      });
      expect(after!.revokedAt).not.toBeNull();
      expect(
        await redisConnection!.get(`lwcli:access:${result.access_token}`),
      ).toBeNull();
      expect(
        await redisConnection!.get(`lwcli:refresh:${result.refresh_token}`),
      ).toBeNull();
    });
  });

  describe("when the approver loses access between approve and exchange", () => {
    /** @scenario "access lost between approve and exchange ends the login" */
    it("answers a fatal access_denied and burns the device code", async () => {
      identity.current = memberUser;
      const dc = await mintDeviceCode();
      const approved = await approve({
        userCode: dc.user_code,
        keySelection: {
          bindings: [{ scope_type: "TEAM", scope_id: TEAM_SHARED_ID }],
          permissions: ["traces:view"],
        },
      });
      expect(approved.status).toBe(200);

      // The window between approve and exchange is minutes wide in practice.
      // Take the access the selection was approved against away inside it:
      // removed from the organization, the approver holds nothing anywhere,
      // so the mint refuses however the selection was scoped.
      const removedBindings = await prisma.roleBinding.findMany({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });
      const removedMemberships = await prisma.organizationUser.findMany({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });
      await prisma.roleBinding.deleteMany({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });
      await prisma.organizationUser.deleteMany({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });

      try {
        const exchanged = await exchange({
          deviceCode: dc.device_code,
          hostname: `lost-access-${suffix}`,
        });

        expect(exchanged.status).toBe(410);
        expect((exchanged.json as unknown as { error: string }).error).toBe(
          "access_denied",
        );
        // Burned, so the CLI's next poll cannot re-run the ceiling walk.
        expect(await redisConnection!.get(`lwcli:device:${dc.device_code}`)).toBeNull();
      } finally {
        await prisma.organizationUser.createMany({
          data: removedMemberships,
          skipDuplicates: true,
        });
        await prisma.roleBinding.createMany({
          data: removedBindings,
          skipDuplicates: true,
        });
      }
    });
  });

  describe("when a re-login from the same device fails at the mint", () => {
    /** @scenario "a failed re-login leaves the previous key working" */
    it("leaves the key already in the user's CLI config active", async () => {
      const HOSTNAME = `failed-relogin-${suffix}`;
      await runFlow({ as: memberUser, hostname: HOSTNAME });
      const firstKey = await mintedKeyFor({
        userId: MEMBER_ID,
        deviceLabel: HOSTNAME,
      });
      expect(firstKey).not.toBeNull();

      identity.current = memberUser;
      const dc = await mintDeviceCode();
      const approved = await approve({
        userCode: dc.user_code,
        keySelection: {
          bindings: [{ scope_type: "TEAM", scope_id: TEAM_SHARED_ID }],
          permissions: ["traces:view"],
        },
      });
      expect(approved.status).toBe(200);

      // Same window the access_denied case uses: the approval is valid and
      // the mint is not, which is the only way to fail a mint from outside.
      const removedBindings = await prisma.roleBinding.findMany({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });
      const removedMemberships = await prisma.organizationUser.findMany({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });
      await prisma.roleBinding.deleteMany({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });
      await prisma.organizationUser.deleteMany({
        where: { organizationId: ORG_ID, userId: MEMBER_ID },
      });

      try {
        const exchanged = await exchange({
          deviceCode: dc.device_code,
          hostname: HOSTNAME,
        });
        expect(exchanged.status).toBe(410);

        const firstAfter = await prisma.apiKey.findFirst({
          where: { id: firstKey!.id, organizationId: ORG_ID },
          select: { revokedAt: true },
        });
        expect(firstAfter!.revokedAt).toBeNull();

        // And no half-minted replacement outlives the failed exchange.
        const active = await prisma.apiKey.count({
          where: {
            organizationId: ORG_ID,
            userId: MEMBER_ID,
            createdByDeviceLabel: HOSTNAME,
            revokedAt: null,
          },
        });
        expect(active).toBe(1);
      } finally {
        await prisma.organizationUser.createMany({
          data: removedMemberships,
          skipDuplicates: true,
        });
        await prisma.roleBinding.createMany({
          data: removedBindings,
          skipDuplicates: true,
        });
      }
    });
  });

  describe("when the owner is demoted after the key was minted", () => {
    /** @scenario "the key can never exceed the owner's live permissions" */
    it("refuses a trace search on a project the owner can no longer view", async () => {
      const HOSTNAME = `ceiling-${suffix}`;
      const result = await runFlow({ as: ceilingUser, hostname: HOSTNAME });
      const cliKey = result.cli_api_key!;

      // Positive control before the demotion: the key reaches the project.
      const before = await projectsApp.request(`/api/projects/${PROJECT_B_ID}`, {
        headers: { Authorization: `Bearer ${cliKey}` },
      });
      expect(before.status).toBe(200);

      // Demote: the owner keeps org membership but loses the org-wide role.
      await prisma.roleBinding.deleteMany({
        where: { organizationId: ORG_ID, userId: CEILING_ID },
      });
      await prisma.organizationUser.updateMany({
        where: { userId: CEILING_ID, organizationId: ORG_ID },
        data: { role: OrganizationUserRole.MEMBER },
      });

      const basic = Buffer.from(`${PROJECT_B_ID}:${cliKey}`).toString("base64");
      const res = await tracesApp.request("/api/traces/search", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });
  });
});
