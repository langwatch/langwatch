/**
 * The identity fold's store against real Postgres (ADR-101 §3, ADR-116):
 * rows are upserted whole, replay's writes win over stated linkage, and the
 * fold never overwrites a secret column it cannot know about.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it.
 * Spec: specs/identity/identifier-model.feature.
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaIdentityProjectionRepository } from "../prisma.identity-projection.repository";
import { PrismaIdentityReservationRepository } from "../prisma.identity-reservations.repository";
import type { IdentityFoldState } from "../../../projections/identity-state.projection";
import type { IdentifierFact } from "@langwatch/identity-contract";
import { createTenantId } from "@langwatch/eventing";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `idproj-${nanoid(8)}`;
const USER = `${namespace}-user`;

function projection(
  identifiers: IdentityFoldState["identifiers"],
  cursor: { acceptedAt: number; eventId: string },
) {
  return {
    state: {
      userId: USER,
      identifiers,
      CreatedAt: 1,
      UpdatedAt: 2,
      LastEventOccurredAt: 3,
    },
    cursor,
    occurredAt: 1_690_000_000_000,
    createdAt: 1_690_000_000_000,
    updatedAt: 1_690_000_000_000,
    version: "2026-08-20",
  };
}

const fact = (id: string, state: "ATTACHED" | "VERIFIED" | "DETACHED"): IdentifierFact => ({
  identifierId: id,
  userId: USER,
  provider: "google",
  value: `${namespace}@acme.com`,
  domain: "acme.com",
  identifierHash: "hmac:abc",
  accountId: `${namespace}-acc`,
  providerId: "google",
  issuer: "google",
  providerAccountId: `${namespace}-sub`,
  connectionId: null,
  state,
  verifiedAtMs: state === "ATTACHED" ? null : 1_690_000_001_000,
  attachedAtMs: 1_690_000_000_000,
  detachedAtMs: state === "DETACHED" ? 1_690_000_002_000 : null,
});

describe.skipIf(!DB_URL)("PrismaIdentityProjectionRepository", () => {
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient | undefined;
  let repository: PrismaIdentityProjectionRepository;

  connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  prisma = connection.client as PrismaClient;
  repository = new PrismaIdentityProjectionRepository(
    prisma,
    PrismaIdentityReservationRepository.create(prisma),
  );

  async function withUserRow() {
    await prisma!.user.upsert({
      where: { id: USER },
      create: { id: USER, email: `${USER}@acme.com` },
      update: {},
    });
  }

  afterAll(async () => {
    if (!prisma) return;
    await prisma.identifier.deleteMany({ where: { userId: USER } });
    await prisma.identityProjectionCursor.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.$disconnect();
  });

  describe("when the fold projects Account", () => {
    /** @scenario "The fold projects the linkage columns of Account" */
    it("writes the linkage the fact names, and nothing else", async () => {
      await withUserRow();
      const id = `${namespace}-linked`;

      await repository.store(
        projection({ [id]: fact(id, "VERIFIED") }, { acceptedAt: 10, eventId: "evt_1" }),
        { aggregateId: USER, tenantId: createTenantId(USER) },
      );

      const row = await prisma!.account.findUnique({ where: { id: `${namespace}-acc` } });
      expect(row).toMatchObject({
        userId: USER,
        provider: "google",
        providerAccountId: `${namespace}-sub`,
      });
      expect(row?.type).toBe("oauth");
    });

    /** @scenario "A replay never overwrites a credential the fold cannot know" */
    it("leaves every secret column exactly as it found it", async () => {
      await withUserRow();
      const id = `${namespace}-linked`;
      const secrets = {
        access_token: "at_refreshed",
        refresh_token: "rt_refreshed",
        password: "hashed",
        scope: "openid email",
      };
      await prisma!.account.upsert({
        where: { id: `${namespace}-acc` },
        create: {
          id: `${namespace}-acc`,
          userId: USER,
          provider: "google",
          providerAccountId: `${namespace}-sub`,
          ...secrets,
        },
        update: secrets,
      });

      await repository.store(
        projection({ [id]: fact(id, "VERIFIED") }, { acceptedAt: 11, eventId: "evt_2" }),
        { aggregateId: USER, tenantId: createTenantId(USER) },
      );

      const row = await prisma!.account.findUnique({ where: { id: `${namespace}-acc` } });
      expect(row).toMatchObject(secrets);
    });

    /** @scenario "A tombstoned identifier projects to no Account row" */
    it("removes the row a detached identifier projected to", async () => {
      await withUserRow();
      const id = `${namespace}-linked`;
      await repository.store(
        projection({ [id]: fact(id, "VERIFIED") }, { acceptedAt: 12, eventId: "evt_3" }),
        { aggregateId: USER, tenantId: createTenantId(USER) },
      );
      expect(
        await prisma!.account.findUnique({ where: { id: `${namespace}-acc` } }),
      ).not.toBeNull();

      await repository.store(
        projection({ [id]: fact(id, "DETACHED") }, { acceptedAt: 13, eventId: "evt_4" }),
        { aggregateId: USER, tenantId: createTenantId(USER) },
      );

      expect(await prisma!.account.findUnique({ where: { id: `${namespace}-acc` } })).toBeNull();
    });

    /** @scenario "The fold reports a user it cannot find, and projects anyway" */
    it("writes the rows for a user with no User row (the anomaly is only logged)", async () => {
      const orphanUser = `${namespace}-no-user-row`;
      const id = `${namespace}-orphan-linked`;
      const orphanFact: IdentifierFact = { ...fact(id, "VERIFIED"), userId: orphanUser };

      await repository.store(
        {
          state: {
            userId: orphanUser,
            identifiers: { [id]: orphanFact },
            CreatedAt: 1,
            UpdatedAt: 2,
            LastEventOccurredAt: 3,
          },
          cursor: { acceptedAt: 14, eventId: "evt_5" },
          occurredAt: 1_690_000_000_000,
          createdAt: 1_690_000_000_000,
          updatedAt: 1_690_000_000_000,
          version: "2026-08-20",
        },
        { aggregateId: orphanUser, tenantId: createTenantId(orphanUser) },
      );

      expect(
        await prisma!.account.findUnique({ where: { id: `${namespace}-acc` } }),
      ).not.toBeNull();
      expect(await prisma!.identifier.findUnique({ where: { id } })).not.toBeNull();

      await prisma!.identifier.deleteMany({ where: { userId: orphanUser } });
      await prisma!.identityProjectionCursor.deleteMany({ where: { userId: orphanUser } });
      await prisma!.account.deleteMany({ where: { userId: orphanUser } });
    });
  });
});
