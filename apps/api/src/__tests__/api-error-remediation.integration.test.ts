/**
 * The remediation channel on a live refusal: the plan gate's 402 reaches the caller with the
 * tips and documentation link the refusal carries, on the api booted wholly live (§7).
 * @vitest-environment node
 * @see specs/licensing/management-apis-enterprise-gate.feature
 * @see specs/errors/canonical-rest-error-envelope.feature
 */
import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PREFIX } from "@langwatch/api-key-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
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
      logger: createLogger("langwatch:test:api-error-remediation"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = generate("test").toString().toLowerCase();

const wireBody = z.looseObject({
  code: z.string().optional(),
  meta: z.looseObject({ feature: z.string().optional() }).optional(),
  tips: z.array(z.string()).optional(),
  docs_url: z.string().optional(),
  fault: z.string().optional(),
});

describe.skipIf(!stores)("given a refusal that knows its next step on the live api", () => {
  let api: Awaited<ReturnType<typeof bootLiveApi>>;
  let userId: string;
  let organizationId: string;
  let key: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Ada", email: `ada-remediation-${ns}@example.com` },
    });
    userId = user.id;
    const organization = await prisma.organization.create({
      data: { name: `plain ${ns}`, slug: `--test-org-remediation-${ns}`, license: null },
    });
    organizationId = organization.id;
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
        id: `grant-admin-remediation-${ns}`,
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
        name: `remediation ${ns}`,
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
        id: `grant-key-remediation-${ns}`,
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
    key = `${API_KEY_PREFIX}${lookupId}_${secret}`;
    api = await bootLiveApi({});
  }, 240_000);

  afterAll(async () => {
    await api?.close();
    if (organizationId) {
      await prisma.grant.deleteMany({ where: { organizationId } });
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: organizationId } });
      await prisma.apiKey.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await connection?.closeOnce();
  });

  describe("when the organization below Enterprise asks for the organization API", () => {
    /** @scenario "The organization API requires an Enterprise plan" */
    it("is refused with 402, the feature, the upgrade tips and the documentation link", async () => {
      const response = await api.fetch("/api/organization", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const refused = wireBody.parse(await response.json());

      expect(response.status).toBe(402);
      expect(refused.code).toBe("enterprise_plan_required");
      expect(refused.meta?.feature).toBe("MANAGEMENT_API");
      expect(refused.tips?.length).toBeGreaterThan(0);
      expect(refused.docs_url).toMatch(/^https?:\/\//);
      expect(refused.fault).toBe("customer");
    });
  });
});
