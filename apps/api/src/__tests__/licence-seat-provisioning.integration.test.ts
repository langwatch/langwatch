/**
 * Seats at SCIM provisioning (ruling of 2026-10-09), on the api booted wholly live over Postgres, Redis and
 * ClickHouse: the plan resolves from the organization's stored licence, as in production.
 * @vitest-environment node
 * @see specs/licensing/seat-limit-at-provisioning.feature
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
      logger: createLogger("langwatch:test:licence-seat-provisioning"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();
const DOMAIN = `acme-${ns}.example`;
const FULL_SEAT_ROLES: readonly string[] = ["ADMIN", "MEMBER"];
const mintedToken = z.looseObject({ token: z.string() });

function signedEnterpriseLicense({
  privateKey,
  maxMembers,
  maxMembersLite,
}: {
  privateKey: string;
  maxMembers: number;
  maxMembersLite?: number;
}): string {
  const data: LicenseData = {
    licenseId: `lic-${ns}-${maxMembers}`,
    version: 1,
    organizationName: `ACME ${ns}`,
    email: "admin@acme.example",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2099-12-31T23:59:59Z",
    plan: {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers,
      ...(maxMembersLite === undefined ? {} : { maxMembersLite }),
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

describe.skipIf(!stores)("given SCIM provisioning on a licensed organization", () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  let api: Awaited<ReturnType<typeof bootLiveApi>>;
  let adminUserId: string;
  const organizationIds: string[] = [];

  /** An organization whose admin holds its one full seat, its org key and an SSO connection. */
  async function seedOrganization({
    name,
    maxMembers,
    maxMembersLite,
  }: {
    name: string;
    maxMembers: number;
    maxMembersLite?: number;
  }) {
    const organization = await prisma.organization.create({
      data: {
        name: `${name} ${ns}`,
        slug: `--test-org-${name}-${ns}`,
        license: signedEnterpriseLicense({
          privateKey: keys.privateKey,
          maxMembers,
          ...(maxMembersLite === undefined ? {} : { maxMembersLite }),
        }),
      },
    });
    const organizationId = organization.id;
    organizationIds.push(organizationId);
    await prisma.organizationUser.create({
      data: { userId: adminUserId, organizationId, role: "ADMIN" },
    });
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
        name: `${name} ${ns}`,
        lookupId,
        hashedSecret: createHash("sha256").update(secret).digest("hex"),
        permissionMode: "all",
        userId: adminUserId,
        createdByUserId: adminUserId,
        organizationId,
      },
    });
    for (const [principalType, principalId] of [
      ["USER", adminUserId],
      ["API_KEY", apiKey.id],
    ] as const) {
      await prisma.grant.create({
        data: {
          id: `grant-${principalType}-${name}-${ns}`,
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
    const now = new Date();
    const connectionId = `sso-${name}-${ns}`;
    await prisma.ssoConnection.create({
      data: {
        id: connectionId,
        organizationId,
        type: "oidc",
        state: "active",
        claimedDomains: [DOMAIN],
        approvedDomains: [DOMAIN],
        verifiedDomains: [DOMAIN],
        lapsedDomains: [],
        idpMetadata: {},
        source: "test",
        occurredAt: now,
        lastEventId: `event-${name}-${ns}`,
        acceptedAt: now,
        projectionVersion: "1",
        createdAt: now,
        updatedAt: now,
      },
    });
    const minted = await api.fetch("/api/scim-tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY_PREFIX}${lookupId}_${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: `Directory ${ns}`, connectionId }),
    });

    return { organizationId, scimToken: mintedToken.parse(await minted.json()).token };
  }

  async function provision({ scimToken, email }: { scimToken: string; email: string }) {
    const response = await api.fetch("/api/scim/v2/Users", {
      method: "POST",
      headers: { Authorization: `Bearer ${scimToken}`, "Content-Type": "application/scim+json" },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: email,
        name: { givenName: "Grace", familyName: "Hopper" },
        active: true,
      }),
    });
    const user = await prisma.user.findFirst({ where: { email } });
    const membership = user
      ? await prisma.organizationUser.findFirst({ where: { userId: user.id } })
      : null;

    return { status: response.status, membership };
  }

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: "Ada", email: `ada-seats-${ns}@example.com` },
    });
    adminUserId = admin.id;
    api = await bootLiveApi({ environment: { LANGWATCH_LICENSE_PUBLIC_KEY: keys.publicKey } });
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (organizationIds.length > 0) {
      const where = { organizationId: { in: organizationIds } };
      const members = await prisma.organizationUser.findMany({ where, select: { userId: true } });
      const provisioned = members.map((member) => member.userId).filter((id) => id !== adminUserId);
      await prisma.scimToken.deleteMany({ where });
      await prisma.ssoConnection.deleteMany({ where });
      await prisma.grant.deleteMany({ where });
      await prisma.systemMigrationTenantState.deleteMany({
        where: { tenantId: { in: organizationIds } },
      });
      await prisma.apiKey.deleteMany({ where });
      await prisma.organizationUser.deleteMany({ where });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await prisma.user.deleteMany({ where: { id: { in: provisioned } } });
    }
    if (adminUserId) await prisma.user.deleteMany({ where: { id: adminUserId } });
    await connection?.closeOnce();
  });

  describe("when the licence covers more full seats than are in use", () => {
    /** @scenario "A SCIM create within the seats admits a full member" */
    it("answers created and admits a full member", async () => {
      const { scimToken } = await seedOrganization({ name: "within", maxMembers: 5 });

      const { status, membership } = await provision({
        scimToken,
        email: `within-${ns}@${DOMAIN}`,
      });

      expect(status).toBe(201);
      expect(FULL_SEAT_ROLES).toContain(membership?.role);
    });
  });

  describe("when every full seat the licence covers is in use", () => {
    /** @scenario "A SCIM create past the seats is admitted, not refused" */
    it("answers created and admits the person as a member", async () => {
      const { organizationId, scimToken } = await seedOrganization({ name: "full", maxMembers: 1 });

      const { status, membership } = await provision({ scimToken, email: `over-${ns}@${DOMAIN}` });

      expect(status).toBe(201);
      expect(membership?.organizationId).toBe(organizationId);
      expect(FULL_SEAT_ROLES).not.toContain(membership?.role);
    });

    /** @scenario "A SCIM create past the full seats is admitted as a Lite Member" */
    it("admits the person as a Lite Member who can sign in", async () => {
      const { scimToken } = await seedOrganization({ name: "lite", maxMembers: 1 });

      const { status, membership } = await provision({ scimToken, email: `lite-${ns}@${DOMAIN}` });

      expect(status).toBe(201);
      expect(membership?.role).toBe("EXTERNAL");
      expect(membership?.disabledAt).toBeNull();
    });

    /** @scenario "A retried create past the seats does not promote the person" */
    it("leaves a retried create on the Lite Member seat", async () => {
      const { scimToken } = await seedOrganization({ name: "retry", maxMembers: 1 });
      const email = `retry-${ns}@${DOMAIN}`;
      await provision({ scimToken, email });

      const { membership } = await provision({ scimToken, email });

      expect(membership?.role).toBe("EXTERNAL");
    });
  });

  describe("when every full and every Lite Member seat is in use", () => {
    /** @scenario "A SCIM create past every full and Lite Member seat is held pending" */
    it("answers created and holds the person pending without access", async () => {
      const { scimToken } = await seedOrganization({
        name: "pending",
        maxMembers: 1,
        maxMembersLite: 0,
      });

      const { status, membership } = await provision({
        scimToken,
        email: `pending-${ns}@${DOMAIN}`,
      });

      expect(status).toBe(201);
      expect(membership?.role).toBe("EXTERNAL");
      expect(membership?.disabledAt).not.toBeNull();
    });
  });
});
