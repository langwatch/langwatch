/**
 * @vitest-environment node
 * A test sign-in counts towards going live only through the issuer the
 * connection dials now: one whose subject was bound under another issuer was
 * made before the identity provider settings changed.
 * @see specs/identity/sso-connection-edit-identity-provider.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaSsoMigrationEvidenceRepository } from "../prisma.sso-migration-evidence.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `ssoiss${nanoid(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x")}`;
const ORGANIZATION_ID = `${namespace}-org`;
const CONNECTION_ID = `${namespace}-conn`;
const OLD_ISSUER = "https://login.microsoftonline.com/wrong-tenant/v2.0";
const NEW_ISSUER = "https://login.microsoftonline.com/right-tenant/v2.0";
const ANA = `${namespace}-ana`;
const BO = `${namespace}-bo`;
const T0 = 1_756_000_000_000;

describe.skipIf(!DB_URL)("test sign-ins read through the connection's current issuer", () => {
  const connectionToDatabase = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:sso-evidence-issuer"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connectionToDatabase.client;
  const evidence = PrismaSsoMigrationEvidenceRepository.create(prisma, () => nanoid());

  beforeAll(async () => {
    for (const id of [ANA, BO]) {
      await prisma.user.create({ data: { id, name: id, email: `${id}@acme.test` } });
    }
    // Ana signed in through the old issuer, Bo through the new one.
    await prisma.account.create({
      data: {
        userId: ANA,
        provider: CONNECTION_ID,
        issuer: OLD_ISSUER,
        providerAccountId: `${namespace}|ana`,
      },
    });
    await prisma.account.create({
      data: {
        userId: BO,
        provider: CONNECTION_ID,
        issuer: NEW_ISSUER,
        providerAccountId: `${namespace}|bo`,
      },
    });
    await evidence.recordAuthentication({
      organizationId: ORGANIZATION_ID,
      connectionId: CONNECTION_ID,
      userId: ANA,
      authenticatedAtMs: T0 + 2_000,
      providerAccountId: `${namespace}|ana`,
    });
    await evidence.recordAuthentication({
      organizationId: ORGANIZATION_ID,
      connectionId: CONNECTION_ID,
      userId: BO,
      authenticatedAtMs: T0 + 1_000,
      providerAccountId: `${namespace}|bo`,
    });
  });

  afterAll(async () => {
    await prisma.ssoAuthenticationActivity.deleteMany({
      where: { organizationId: ORGANIZATION_ID, connectionId: CONNECTION_ID },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ANA, BO] } } });
    await prisma.$disconnect();
  });

  describe("when the connection's issuer changed after a test sign-in", () => {
    /** @scenario "A new issuer needs a new test sign-in before going live" */
    it("leaves out the sign-in bound under the old issuer", async () => {
      const recent = await evidence.findRecentAuthentications({
        organizationId: ORGANIZATION_ID,
        connectionId: CONNECTION_ID,
        limit: 10,
        issuer: NEW_ISSUER,
      });

      expect(recent.map((row) => row.userId)).toEqual([BO]);
      await expect(
        evidence.findLastAuthenticationAtMs({
          organizationId: ORGANIZATION_ID,
          connectionId: CONNECTION_ID,
          issuer: NEW_ISSUER,
        }),
      ).resolves.toBe(T0 + 1_000);
    });
  });

  describe("when no issuer is named", () => {
    it("counts every recorded sign-in", async () => {
      const recent = await evidence.findRecentAuthentications({
        organizationId: ORGANIZATION_ID,
        connectionId: CONNECTION_ID,
        limit: 10,
      });

      expect(recent.map((row) => row.userId)).toEqual([ANA, BO]);
    });
  });
});
