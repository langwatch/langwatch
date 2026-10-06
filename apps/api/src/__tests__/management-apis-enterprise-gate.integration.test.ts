/**
 * The management APIs behind the Enterprise gate, asked with an organization key through the door
 * auth binds, on the api booted wholly live over Postgres, Redis and ClickHouse (§7): the plan
 * resolves from the organization's stored licence through the entitlement peer, as in production.
 * @vitest-environment node
 * @see specs/licensing/management-apis-enterprise-gate.feature
 */
import { createHash, generateKeyPairSync, randomBytes, createSign } from "node:crypto";

import { API_KEY_PREFIX } from "@langwatch/api-key-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import type { LicenseData } from "@langwatch/enterprise-licensing-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { bootLiveApi, liveDatabaseUrl, liveStoresConfigured } from "./api-live.fixture.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const stores = liveStoresConfigured;

/** The suite's own connection, for the rows the gate reads and for cleanup. */
const connection = stores
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:management-apis-enterprise-gate"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();

const MANAGEMENT_PATHS = {
  organization: "/api/organization",
  roles: "/api/roles",
  roleBindings: "/api/role-bindings",
  scimTokens: "/api/scim-tokens",
  groups: "/api/groups",
} as const;

const wireBody = z.looseObject({
  code: z.string().optional(),
  meta: z.looseObject({ feature: z.string().optional() }).optional(),
});

/** The licence an Enterprise organization holds: signed by a key pair only this suite knows. */
function signedEnterpriseLicense({ privateKey }: { privateKey: string }): string {
  const data: LicenseData = {
    licenseId: `lic-${ns}`,
    version: 1,
    organizationName: `ACME ${ns}`,
    email: "admin@acme.example",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2099-12-31T23:59:59Z",
    plan: {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxProjects: 500,
      maxMessagesPerMonth: 10_000_000,
      maxWorkflows: 1000,
      maxPrompts: 1000,
      maxEvaluators: 1000,
      maxScenarios: 1000,
      canPublish: true,
    },
  };
  const signature = createSign("SHA256").update(JSON.stringify(data)).sign(privateKey, "base64");

  return Buffer.from(JSON.stringify({ data, signature }), "utf-8").toString("base64");
}

describe.skipIf(!stores)("given the management APIs on the live api", () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  let api: Awaited<ReturnType<typeof bootLiveApi>>;
  let userId: string;
  const organizations: { id: string; key: string }[] = [];
  let unlicensed: { id: string; key: string };
  let licensed: { id: string; key: string };

  /** An organization with an admin and the organization-scoped key a CLI login mints. */
  async function seedOrganization({ name, license }: { name: string; license: string | null }) {
    const organization = await prisma.organization.create({
      data: { name: `${name} ${ns}`, slug: `--test-org-${name}-${ns}`, license },
    });
    const organizationId = organization.id;
    await prisma.organizationUser.create({ data: { userId, organizationId, role: "ADMIN" } });
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organizationId,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant-admin-${name}-${ns}`,
        organizationId,
        principalType: "USER",
        principalId: userId,
        roleKey: "admin",
        source: "grants-service",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
      },
    });
    const lookupId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const apiKey = await prisma.apiKey.create({
      data: {
        name: `${name} ${ns}`,
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        permissionMode: "all",
        userId,
        createdByUserId: userId,
        organizationId,
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant-key-${name}-${ns}`,
        organizationId,
        principalType: "API_KEY",
        principalId: apiKey.id,
        roleKey: "admin",
        source: "grants-service",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
      },
    });
    const seeded = { id: organizationId, key: `${API_KEY_PREFIX}${lookupId}_${secret}` };
    organizations.push(seeded);

    return seeded;
  }

  async function ask({ path, token }: { path: string; token: string }) {
    const response = await api.fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    const text = await response.text();

    return { status: response.status, text, body: wireBody.parse(JSON.parse(text)) };
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Ada", email: `ada-gate-${ns}@example.com` },
    });
    userId = user.id;
    unlicensed = await seedOrganization({ name: "plain", license: null });
    licensed = await seedOrganization({
      name: "licensed",
      license: signedEnterpriseLicense({ privateKey: keys.privateKey }),
    });
    await prisma.group.create({
      data: { organizationId: unlicensed.id, name: `Secret ${ns}`, slug: `secret-${ns}` },
    });
    api = await bootLiveApi({ environment: { LANGWATCH_LICENSE_PUBLIC_KEY: keys.publicKey } });
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    const ids = organizations.map((organization) => organization.id);
    if (ids.length > 0) {
      await prisma.group.deleteMany({ where: { organizationId: { in: ids } } });
      await prisma.grant.deleteMany({ where: { organizationId: { in: ids } } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: { in: ids } } });
      await prisma.apiKey.deleteMany({ where: { organizationId: { in: ids } } });
      await prisma.organizationUser.deleteMany({ where: { organizationId: { in: ids } } });
      await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await connection?.closeOnce();
  });

  describe("when the organization is below the Enterprise plan", () => {
    it("refuses the organization with the feature it asked for", async () => {
      const refused = await ask({ path: MANAGEMENT_PATHS.organization, token: unlicensed.key });

      expect(refused.status).toBe(402);
      expect(refused.body.code).toBe("enterprise_plan_required");
      expect(refused.body.meta?.feature).toBe("MANAGEMENT_API");
    });

    /** @scenario "Group endpoints require an Enterprise plan" */
    it("refuses the group list and discloses no group", async () => {
      const refused = await ask({ path: MANAGEMENT_PATHS.groups, token: unlicensed.key });
      const stored = await prisma.group.findMany({ where: { organizationId: unlicensed.id } });

      expect(refused.status).toBe(402);
      expect(refused.body.code).toBe("enterprise_plan_required");
      expect(refused.text).not.toContain(`Secret ${ns}`);
      expect(stored.map((group) => group.name)).toEqual([`Secret ${ns}`]);
    });
  });

  describe("when an Enterprise license is activated on the organization", () => {
    /** @scenario "The organization API grants access under an activated license" */
    it("answers the organization", async () => {
      const granted = await ask({ path: MANAGEMENT_PATHS.organization, token: licensed.key });

      expect(granted.status).toBe(200);
    });

    /** @scenario "The roles API grants access under an activated license" */
    it("answers the custom role list", async () => {
      const granted = await ask({ path: MANAGEMENT_PATHS.roles, token: licensed.key });

      expect(granted.status).toBe(200);
    });

    /** @scenario "The role bindings API grants access under an activated license" */
    it("answers the role binding list", async () => {
      const granted = await ask({ path: MANAGEMENT_PATHS.roleBindings, token: licensed.key });

      expect(granted.status).toBe(200);
    });

    /** @scenario "The SCIM tokens API grants access under an activated license" */
    it("answers the SCIM token list", async () => {
      const granted = await ask({ path: MANAGEMENT_PATHS.scimTokens, token: licensed.key });

      expect(granted.status).toBe(200);
    });

    /** @scenario "Group endpoints grant access under an activated license" */
    it("answers the group list", async () => {
      const granted = await ask({ path: MANAGEMENT_PATHS.groups, token: licensed.key });

      expect(granted.status).toBe(200);
    });
  });
});
