import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import type { StoredProjection } from "~/server/event-sourcing/projections/stateProjection.types";
import { PrismaIdentityProjectionRepository } from "../identity-projection.prisma.repository";

/**
 * The fold's store against real Postgres: rows are upserted whole
 * (ADR-101 §3, replay's writes win), the cursor is the commit marker written
 * LAST, and a store that never ran leaves `load` answering null so the fold
 * starts from init rather than a half-written head.
 */
const namespace = `idproj-${nanoid(8)}`;
const USER = `${namespace}-user`;
const repository = new PrismaIdentityProjectionRepository(prisma);
const context = { aggregateId: USER, tenantId: createTenantId(USER) };

function projection(
  identifiers: IdentityFoldState["identifiers"],
  cursor: { acceptedAt: number; eventId: string },
): StoredProjection<IdentityFoldState> {
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

const fact = (id: string, state: "ATTACHED" | "VERIFIED" | "DETACHED") => ({
  identifierId: id,
  userId: USER,
  provider: "email" as const,
  value: `${namespace}@acme.com`,
  domain: "acme.com",
  identifierHash: "hmac:abc",
  accountId: null,
  providerAccountId: null,
  connectionId: null,
  state,
  verifiedAtMs: state === "ATTACHED" ? null : 1_690_000_001_000,
  attachedAtMs: 1_690_000_000_000,
  detachedAtMs: state === "DETACHED" ? 1_690_000_002_000 : null,
});

/** A fact that projects to an `Account` row: it names the row it projects
 *  to, and the provider subject that row is keyed by. */
const linkedFact = (
  id: string,
  state: "ATTACHED" | "VERIFIED" | "DETACHED",
  overrides?: { accountId?: string; providerAccountId?: string },
) => ({
  ...fact(id, state),
  provider: "google" as const,
  accountId: overrides?.accountId ?? `${namespace}-acc`,
  providerAccountId: overrides?.providerAccountId ?? `${namespace}-sub`,
});

/** `Account.userId` is a real foreign key, so the user has to exist. */
async function withUserRow() {
  await prisma.user.upsert({
    where: { id: USER },
    create: { id: USER, email: `${USER}@acme.com` },
    update: {},
  });
}

afterEach(async () => {
  await prisma.identifier.deleteMany({ where: { userId: USER } });
  await prisma.identityProjectionCursor.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("PrismaIdentityProjectionRepository", () => {
  describe("when the fold projects Account (ADR-116)", () => {
    /** @scenario "The fold projects the linkage columns of Account" */
    it("writes the linkage the fact names, and nothing else", async () => {
      await withUserRow();
      const id = `${namespace}-linked`;

      await repository.store(
        projection(
          { [id]: linkedFact(id, "VERIFIED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      const row = await prisma.account.findUnique({
        where: { id: `${namespace}-acc` },
      });
      expect(row).toMatchObject({
        userId: USER,
        provider: "google",
        providerAccountId: `${namespace}-sub`,
      });
      // `type` is a legacy NextAuth column better-auth does not map. The
      // fold leaves it to its default rather than guessing at a value.
      expect(row?.type).toBe("oauth");
    });

    /** @scenario "A replay never overwrites a credential the fold cannot know" */
    it("leaves every secret column exactly as it found it", async () => {
      await withUserRow();
      const id = `${namespace}-linked`;
      const secrets = {
        access_token: "at_refreshed",
        refresh_token: "rt_refreshed",
        id_token: "idt",
        password: "hashed",
        scope: "openid email",
        token_type: "Bearer",
        session_state: "state",
        expires_at: new Date(1_700_000_000_000),
        ext_expires_in: 3600,
      };
      await prisma.account.create({
        data: {
          id: `${namespace}-acc`,
          userId: USER,
          provider: "google",
          providerAccountId: `${namespace}-sub`,
          ...secrets,
        },
      });

      await repository.store(
        projection(
          { [id]: linkedFact(id, "VERIFIED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      // The payload rule cuts both ways: secrets can never become events,
      // so a replay must never claim to know them. Clobbering these would
      // undo a token refresh that legitimately happened after the event.
      const row = await prisma.account.findUnique({
        where: { id: `${namespace}-acc` },
      });
      expect(row).toMatchObject(secrets);
    });

    /** @scenario "A tombstoned identifier projects to no Account row" */
    it("removes the row a detached identifier projected to", async () => {
      await withUserRow();
      const id = `${namespace}-linked`;
      await repository.store(
        projection(
          { [id]: linkedFact(id, "VERIFIED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );
      expect(
        await prisma.account.findUnique({ where: { id: `${namespace}-acc` } }),
      ).not.toBeNull();

      await repository.store(
        projection(
          { [id]: linkedFact(id, "DETACHED") },
          { acceptedAt: 20, eventId: "evt_2" },
        ),
        context,
      );

      expect(
        await prisma.account.findUnique({ where: { id: `${namespace}-acc` } }),
      ).toBeNull();
    });

    it("projects no row for an identifier that names no account", async () => {
      await withUserRow();
      const id = `${namespace}-unlinked`;

      // The email adopted from `User.email` never had an `Account` behind
      // it, so there is nothing to project onto.
      await repository.store(
        projection(
          { [id]: fact(id, "VERIFIED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      expect(
        await prisma.account.findMany({ where: { userId: USER } }),
      ).toEqual([]);
    });

    /** @scenario "The fold says nothing about a user who is gone" */
    it("creates nothing for a deleted user, rather than failing the fold", async () => {
      const id = `${namespace}-linked`;

      // No `User` row: the delete cascaded their accounts away, and
      // recreating one would fail the foreign key rather than restore
      // anything. The fold must still complete.
      await repository.store(
        projection(
          { [id]: linkedFact(id, "VERIFIED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      expect(
        await prisma.account.findUnique({ where: { id: `${namespace}-acc` } }),
      ).toBeNull();
      // The identifier head is still written: it is event truth, and does
      // not depend on the legacy row surviving.
      expect(
        await prisma.identifier.findUnique({ where: { id } }),
      ).not.toBeNull();
    });
  });

  describe("when no fold has ever stored the user", () => {
    it("loads null, so the fold starts from init", async () => {
      expect(await repository.load(USER, context)).toBeNull();
    });
  });

  describe("when a fold stores heads and a cursor", () => {
    it("round-trips rows and cursor, and a later store upserts whole-row", async () => {
      const id = `${namespace}-idf`;
      await repository.store(
        projection(
          { [id]: fact(id, "ATTACHED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      const first = await repository.load(USER, context);
      expect(first?.cursor).toEqual({ acceptedAt: 10, eventId: "evt_1" });
      expect(first?.state.identifiers[id]).toMatchObject({
        state: "ATTACHED",
        verifiedAtMs: null,
      });

      await repository.store(
        projection(
          { [id]: fact(id, "VERIFIED") },
          { acceptedAt: 20, eventId: "evt_2" },
        ),
        context,
      );

      const second = await repository.load(USER, context);
      expect(second?.cursor).toEqual({ acceptedAt: 20, eventId: "evt_2" });
      expect(second?.state.identifiers[id]).toMatchObject({
        state: "VERIFIED",
        verifiedAtMs: 1_690_000_001_000,
      });
      expect(await prisma.identifier.count({ where: { userId: USER } })).toBe(
        1,
      );
    });

    it("keeps a detached row as a tombstone rather than deleting it", async () => {
      const id = `${namespace}-tomb`;
      await repository.store(
        projection(
          { [id]: fact(id, "VERIFIED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );
      await repository.store(
        projection(
          { [id]: fact(id, "DETACHED") },
          { acceptedAt: 20, eventId: "evt_2" },
        ),
        context,
      );

      const row = await prisma.identifier.findUnique({ where: { id } });
      expect(row?.state).toBe("DETACHED");
      expect(row?.detachedAt?.getTime()).toBe(1_690_000_002_000);
      expect(row?.value).toBe(`${namespace}@acme.com`);
    });
  });
});
