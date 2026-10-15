/**
 * @vitest-environment node
 * @see specs/identity/identity-storage-adapter.feature
 *
 * The no-userId reads, against Postgres: an identifier joined to its user's backfill row.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../../rules/identity-migration-names.rules.ts";
import { PrismaIdentityResolutionRepository } from "../prisma.identity-resolution.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const ns = `idresolve-${nanoid(8)}`;
const user = (name: string) => `${ns}-${name}`;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!DB_URL)("PrismaIdentityResolutionRepository", () => {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:resolution"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const repository = PrismaIdentityResolutionRepository.create(prisma);

  function identifier({
    userId,
    suffix,
    provider = "credential",
    state = "VERIFIED",
    value = null,
    issuer = null,
    providerAccountId = null,
    attachedAt = new Date(),
  }: {
    userId: string;
    suffix: string;
    provider?: string;
    state?: string;
    value?: string | null;
    issuer?: string | null;
    providerAccountId?: string | null;
    attachedAt?: Date;
  }) {
    return prisma.identifier.create({
      data: {
        id: `${userId}-${suffix}`,
        userId,
        provider,
        providerId: provider,
        value,
        issuer,
        providerAccountId,
        state,
        attachedAt,
      },
    });
  }

  function backfill({ userId, status }: { userId: string; status: string }) {
    return prisma.systemMigrationTenantState.create({
      data: {
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        tenantId: userId,
        status,
      },
    });
  }

  afterEach(async () => {
    await prisma.identifier.deleteMany({ where: { userId: { startsWith: ns } } });
    for (const tenantId of [user("finalized"), user("held")]) {
      await prisma.systemMigrationTenantState.deleteMany({
        where: { migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME, tenantId },
      });
    }
  });
  afterAll(() => prisma.$disconnect());

  describe("when users hold verified addresses under different backfill states", () => {
    /** @scenario "A resolution is finalized only when the user's own backfill row says finalized" */
    it("reports finalized only for the user whose backfill row says finalized", async () => {
      for (const name of ["finalized", "held", "unbackfilled"]) {
        await identifier({ userId: user(name), suffix: "email", value: `${user(name)}@acme.com` });
      }
      await backfill({ userId: user("finalized"), status: "finalized" });
      await backfill({ userId: user("held"), status: "held" });

      const resolve = (name: string) =>
        repository.getResolutionByIdentifierValue({ normalizedValue: `${user(name)}@acme.com` });

      expect(await resolve("finalized")).toEqual({ userId: user("finalized"), finalized: true });
      expect(await resolve("held")).toEqual({ userId: user("held"), finalized: false });
      expect(await resolve("unbackfilled")).toEqual({
        userId: user("unbackfilled"),
        finalized: false,
      });
    });
  });

  describe("when the only identifier for an address is still attached", () => {
    /** @scenario "An attached address resolves nobody" */
    it("throws identifier-not-found", async () => {
      const value = `${user("attached")}@acme.com`;
      await identifier({ userId: user("attached"), suffix: "email", state: "ATTACHED", value });

      await expect(
        repository.getResolutionByIdentifierValue({ normalizedValue: value }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
    });
  });

  describe("when two users hold the same verified address", () => {
    /** @scenario "The earliest attached identifier answers a resolution" */
    it("answers with the user attached first", async () => {
      const value = `${ns}-shared@acme.com`;
      const now = Date.now();
      await identifier({ userId: user("late"), suffix: "email", value, attachedAt: new Date(now) });
      await identifier({
        userId: user("early"),
        suffix: "email",
        value,
        attachedAt: new Date(now - DAY_MS),
      });

      const resolution = await repository.getResolutionByIdentifierValue({
        normalizedValue: value,
      });

      expect(resolution.userId).toBe(user("early"));
    });
  });

  describe("when a provider subject resolves", () => {
    /** @scenario "A resolution records when the identifier last answered" */
    it("records the identifier's last-used time", async () => {
      const subject = `${ns}-g`;
      await identifier({
        userId: user("google"),
        suffix: "google",
        provider: "google",
        providerAccountId: subject,
      });

      const resolution = await repository.getResolutionByProviderSubject({
        providerId: "google",
        providerAccountId: subject,
      });

      expect(resolution.userId).toBe(user("google"));
      await vi.waitFor(async () => {
        const row = await prisma.identifier.findUnique({
          where: { id: `${user("google")}-google` },
        });
        expect(row?.lastUsedAt).toBeInstanceOf(Date);
      });
    });
  });

  describe("when a connection's issuer and subject resolve", () => {
    /** @scenario "An issuer-subject resolution hands back the row's own provider id" */
    it("names the row's own provider id", async () => {
      const issuer = `https://${ns}.auth0.example/`;
      await identifier({
        userId: user("sso"),
        suffix: "auth0",
        provider: "auth0",
        issuer,
        providerAccountId: `${ns}-sub`,
      });

      const resolution = await repository.getResolutionByIssuerSubject({
        issuer,
        providerAccountId: `${ns}-sub`,
      });

      expect(resolution).toEqual({ userId: user("sso"), finalized: false, providerId: "auth0" });
    });
  });
});
