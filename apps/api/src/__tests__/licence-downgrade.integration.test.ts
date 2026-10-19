/**
 * A licence replaced by fewer seats, a lower plan or nothing, on the api booted wholly live over
 * Postgres, Redis and ClickHouse: each case rewrites the stored licence the entitlement peer reads.
 * @vitest-environment node
 * @see specs/licensing/licence-downgrade.feature
 */
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";

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
const connection = stores
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:licence-downgrade"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();
const ENTERPRISE_PATHS = ["/api/roles", "/api/role-bindings", "/api/scim-tokens", "/api/groups"];
const wireBody = z.looseObject({ code: z.string().optional() });

function signedLicense({
  privateKey,
  type,
  maxMembers,
}: {
  privateKey: string;
  type: "ENTERPRISE" | "PRO";
  maxMembers: number;
}): string {
  const data: LicenseData = {
    licenseId: `lic-${ns}-${type}-${maxMembers}`,
    version: 1,
    organizationName: `ACME ${ns}`,
    email: "admin@acme.example",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2099-12-31T23:59:59Z",
    plan: {
      type,
      name: type === "ENTERPRISE" ? "Enterprise" : "Pro",
      maxMembers,
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

describe.skipIf(!stores)("given an Enterprise organization whose licence is replaced", () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const enterprise = signedLicense({
    privateKey: keys.privateKey,
    type: "ENTERPRISE",
    maxMembers: 100,
  });
  let api: Awaited<ReturnType<typeof bootLiveApi>>;
  let organizationId: string;
  let orgKey: string;
  const userIds: string[] = [];
  const roleName = `Reviewer ${ns}`;

  async function replaceLicence(license: string | null) {
    await prisma.organization.update({ where: { id: organizationId }, data: { license } });
  }

  async function ask(path: string) {
    const response = await api.fetch(path, { headers: { Authorization: `Bearer ${orgKey}` } });
    const text = await response.text();

    return { status: response.status, text, body: wireBody.parse(JSON.parse(text)) };
  }

  async function expectEnterpriseSurfacesRefused() {
    for (const path of ENTERPRISE_PATHS) {
      const refused = await ask(path);
      expect({ path, status: refused.status, code: refused.body.code }).toEqual({
        path,
        status: 402,
        code: "enterprise_plan_required",
      });
    }
  }

  async function storedState() {
    const where = { organizationId };
    const [members, roles, groups, tokens] = await Promise.all([
      prisma.organizationUser.findMany({ where, select: { userId: true, role: true } }),
      prisma.customRole.count({ where: { ...where, name: roleName } }),
      prisma.group.count({ where }),
      prisma.scimToken.count({ where }),
    ]);
    const roleOf = new Map(members.map((member) => [member.userId, member.role]));

    return { roles: userIds.map((id) => roleOf.get(id)), customRoles: roles, groups, tokens };
  }

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Downgrade ${ns}`, slug: `--test-org-downgrade-${ns}`, license: enterprise },
    });
    organizationId = organization.id;
    for (const [index, role] of (["ADMIN", "MEMBER", "MEMBER"] as const).entries()) {
      const user = await prisma.user.create({
        data: { name: `Member ${index}`, email: `member-${index}-${ns}@example.com` },
      });
      userIds.push(user.id);
      await prisma.organizationUser.create({ data: { userId: user.id, organizationId, role } });
    }
    const adminId = userIds[0] ?? "";
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organizationId,
        status: "finalized",
        occurredAt: new Date(),
      },
    });
    const lookupId = randomBytes(8).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const apiKey = await prisma.apiKey.create({
      data: {
        name: `Downgrade ${ns}`,
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        permissionMode: "all",
        userId: adminId,
        createdByUserId: adminId,
        organizationId,
      },
    });
    orgKey = `${API_KEY_PREFIX}${lookupId}_${secret}`;
    for (const [principalType, principalId] of [
      ["USER", adminId],
      ["API_KEY", apiKey.id],
    ] as const) {
      await prisma.grant.create({
        data: {
          id: `grant-${principalType}-downgrade-${ns}`,
          organizationId,
          principalType,
          principalId,
          roleKey: "admin",
          source: "grants-service",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          occurredAt: new Date(),
        },
      });
    }
    await prisma.customRole.create({
      data: { organizationId, name: roleName, permissions: ["project:view"] },
    });
    await prisma.group.create({
      data: { organizationId, name: `Reviewers ${ns}`, slug: `reviewers-${ns}` },
    });
    await prisma.scimToken.create({
      data: {
        organizationId,
        hashedToken: randomBytes(32).toString("hex"),
        hashScheme: "hmac-sha256",
        description: `Directory ${ns}`,
      },
    });
    api = await bootLiveApi({ environment: { LANGWATCH_LICENSE_PUBLIC_KEY: keys.publicKey } });
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (organizationId) {
      const where = { organizationId };
      await prisma.scimToken.deleteMany({ where });
      await prisma.group.deleteMany({ where });
      await prisma.customRole.deleteMany({ where });
      await prisma.grant.deleteMany({ where });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await prisma.apiKey.deleteMany({ where });
      await prisma.organizationUser.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await connection?.closeOnce();
  });

  describe("when the licence is replaced by an Enterprise licence for 1 full seat", () => {
    /** @scenario "A licence for fewer seats than are in use keeps every member" */
    it("keeps all three members with their roles and still answers the organization", async () => {
      await replaceLicence(
        signedLicense({ privateKey: keys.privateKey, type: "ENTERPRISE", maxMembers: 1 }),
      );

      const answered = await ask("/api/organization");

      expect(answered.status).toBe(200);
      expect((await storedState()).roles).toEqual(["ADMIN", "MEMBER", "MEMBER"]);
    });
  });

  describe("when the licence is replaced by a Pro licence", () => {
    /** @scenario "A lower plan refuses the Enterprise management APIs with the feature asked for" */
    it("refuses every Enterprise management API by code", async () => {
      await replaceLicence(
        signedLicense({ privateKey: keys.privateKey, type: "PRO", maxMembers: 100 }),
      );

      await expectEnterpriseSurfacesRefused();
    });

    /** @scenario "A lower plan deletes no member, custom role, group or SCIM token" */
    it("keeps every member, the custom role, the group and the SCIM token", async () => {
      await replaceLicence(
        signedLicense({ privateKey: keys.privateKey, type: "PRO", maxMembers: 100 }),
      );
      await ask("/api/roles");

      expect(await storedState()).toEqual({
        roles: ["ADMIN", "MEMBER", "MEMBER"],
        customRoles: 1,
        groups: 1,
        tokens: 1,
      });
    });
  });

  describe("when the Enterprise licence is restored after a Pro licence", () => {
    /** @scenario "Restoring the Enterprise licence answers the custom role again" */
    it("answers the roles API with the custom role", async () => {
      await replaceLicence(
        signedLicense({ privateKey: keys.privateKey, type: "PRO", maxMembers: 100 }),
      );
      await ask("/api/roles");
      await replaceLicence(enterprise);

      const restored = await ask("/api/roles");

      expect(restored.status).toBe(200);
      expect(restored.text).toContain(roleName);
    });
  });

  describe("when the licence is removed", () => {
    /** @scenario "Removing the licence refuses the same APIs" */
    it("refuses every Enterprise management API by code", async () => {
      await replaceLicence(null);

      await expectEnterpriseSurfacesRefused();
    });
  });
});
