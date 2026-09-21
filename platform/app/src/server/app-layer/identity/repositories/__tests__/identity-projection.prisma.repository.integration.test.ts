import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import type { StoredProjection } from "~/server/event-sourcing/projections/stateProjection.types";
import { PrismaIdentityProjectionRepository } from "../identity-projection.prisma.repository";
import { PrismaIdentityReservationRepository } from "../identity-reservations.prisma.repository";

/**
 * The fold's store against real Postgres: rows are upserted whole
 * (ADR-101 §3, replay's writes win), the cursor is the commit marker written
 * LAST, and a store that never ran leaves `load` answering null so the fold
 * starts from init rather than a half-written head.
 */
const namespace = `idproj-${nanoid(8)}`;
const USER = `${namespace}-user`;
const reservations = new PrismaIdentityReservationRepository(prisma);
const repository = new PrismaIdentityProjectionRepository(prisma, reservations);
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
  providerId: null,
  issuer: null,
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

/** Somebody else entirely, for the collisions that only happen ACROSS users
 *  — `Account`'s uniqueness on (provider, subject) is fleet-wide. */
const INCUMBENT_USER = `${namespace}-incumbent-user`;
const INCUMBENT_ACCOUNT = `${namespace}-incumbent-acc`;
const SHARED_SUBJECT = `${namespace}-shared-sub`;

/** The incumbent: another user's `Account` row already owning the subject. */
async function withIncumbentAccountRow() {
  await prisma.user.upsert({
    where: { id: INCUMBENT_USER },
    create: { id: INCUMBENT_USER, email: `${INCUMBENT_USER}@acme.com` },
    update: {},
  });
  await prisma.account.create({
    data: {
      id: INCUMBENT_ACCOUNT,
      userId: INCUMBENT_USER,
      provider: "google",
      providerAccountId: SHARED_SUBJECT,
      access_token: "at_incumbent",
    },
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.identifierReservation.deleteMany({ where: { userId: USER } });
  await prisma.identifier.deleteMany({ where: { userId: USER } });
  await prisma.identityProjectionCursor.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.account.deleteMany({ where: { userId: INCUMBENT_USER } });
  await prisma.user.deleteMany({ where: { id: INCUMBENT_USER } });
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

    /** @scenario "The fold reports a user it cannot find, and projects anyway" */
    it("writes the rows and reports the anomaly for a user with no User row", async () => {
      const id = `${namespace}-linked`;

      // No `User` row while the log carries this user's linkage: an anomaly,
      // not a branch. The projection stays TOTAL — a fold that silently
      // declined would leave it quietly incomplete with nothing to read about
      // it — and the row carries no database foreign key to prevent the write
      // (`relationMode = "prisma"`).
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
      // The identifier head is written for the same reason: it is event
      // truth, and does not depend on the legacy row surviving.
      expect(
        await prisma.identifier.findUnique({ where: { id } }),
      ).not.toBeNull();
    });

    /** @scenario "The projected Account row keeps better-auth's own provider id" */
    it("keeps better-auth's own provider id rather than the folded vocabulary", async () => {
      await withUserRow();
      const id = `${namespace}-auth0`;

      await repository.store(
        projection(
          {
            [id]: {
              ...linkedFact(id, "VERIFIED"),
              // The vocabulary folds auth0 into `oidc`; the fact carries the
              // unfolded id, and `Account` is keyed by that.
              provider: "oidc" as const,
              providerId: "auth0",
              // The issuer the fact states, which the fold must reproduce
              // rather than derive: better-auth 1.7 looks the row up by it.
              issuer: "local:oauth:auth0",
            },
          },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      const row = await prisma.account.findUnique({
        where: { id: `${namespace}-acc` },
      });
      expect(row?.provider).toBe("auth0");
      // The other half of better-auth 1.7's account key, projected from the
      // fact rather than computed here. It has to be the value the library
      // will ASK for: a row carrying a different issuer is a row its lookup
      // cannot find, which reads as a missing sign-in method.
      expect(row?.issuer).toBe("local:oauth:auth0");
      // Which is what better-auth's own callback lookup asks for.
      expect(
        await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: "auth0",
              providerAccountId: `${namespace}-sub`,
            },
          },
        }),
      ).not.toBeNull();
    });
  });

  describe("when two users' identifiers claim one provider subject", () => {
    const loser = `${namespace}-loser`;
    const loserAccount = `${namespace}-loser-acc`;

    /** The losing user's fact: its own account id, the subject somebody else
     *  already holds. The identifier head itself is uncontested — it carries
     *  no `providerId`, so the projection's own subject index does not apply
     *  and ONLY the `Account` bridge row collides. */
    const losingFact = (state: "VERIFIED" | "DETACHED" = "VERIFIED") =>
      linkedFact(loser, state, {
        accountId: loserAccount,
        providerAccountId: SHARED_SUBJECT,
      });

    /** A fresh store per case: "warned once" is a per-process fact, and a
     *  shared instance would carry one case's sightings into the next. */
    const freshStore = () =>
      new PrismaIdentityProjectionRepository(prisma, reservations);

    /** @scenario "Two users' identifiers claim one provider subject: the incumbent keeps it and the fold stays total" */
    it("finishes the losing user's fold and writes them no bridge row", async () => {
      await withUserRow();
      await withIncumbentAccountRow();

      await freshStore().store(
        projection(
          { [loser]: losingFact() },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      // No row, because there cannot be one: `Account` is unique on
      // (provider, subject) fleet-wide. What matters is that the apply
      // COMPLETED — an uncaught P2002 here retries until the group queue
      // gives up, and this user's identity fold stops for good.
      expect(
        await prisma.account.findUnique({ where: { id: loserAccount } }),
      ).toBeNull();
      expect(
        await prisma.identityProjectionCursor.findUnique({
          where: { userId: USER },
        }),
      ).toMatchObject({ lastEventId: "evt_1" });
      // The identifier head is event truth and is written regardless.
      expect(
        await prisma.identifier.findUnique({ where: { id: loser } }),
      ).not.toBeNull();
    });

    it("leaves the incumbent's row exactly as it found it, over two passes", async () => {
      await withUserRow();
      await withIncumbentAccountRow();
      const store = freshStore();

      await store.store(
        projection(
          { [loser]: losingFact() },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );
      await store.store(
        projection(
          { [loser]: losingFact() },
          { acceptedAt: 20, eventId: "evt_2" },
        ),
        context,
      );

      // Demoting the holder would take a working sign-in method off somebody
      // who has it, to give it to somebody the database just refused.
      expect(
        await prisma.account.findUnique({ where: { id: INCUMBENT_ACCOUNT } }),
      ).toMatchObject({
        userId: INCUMBENT_USER,
        provider: "google",
        providerAccountId: SHARED_SUBJECT,
        access_token: "at_incumbent",
      });
    });

    it("says so once across two passes over the same pair, then at debug", async () => {
      await withUserRow();
      await withIncumbentAccountRow();
      // Cached by name, so this is the very object the repository writes to.
      const logger = createLogger("langwatch:identity:projection");
      const warn = vi.spyOn(logger, "warn");
      const debug = vi.spyOn(logger, "debug");
      const store = freshStore();

      await store.store(
        projection(
          { [loser]: losingFact() },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );
      await store.store(
        projection(
          { [loser]: losingFact() },
          { acceptedAt: 20, eventId: "evt_2" },
        ),
        context,
      );

      // Parking writes nothing, so nothing changes between passes to key on:
      // without the seen-set a permanent condition reads as a storm of new
      // incidents every replay.
      const collisionLines = (spy: typeof warn) =>
        spy.mock.calls.filter(
          ([fields]) =>
            typeof fields === "object" &&
            fields !== null &&
            "parkedAccountId" in fields,
        );
      expect(collisionLines(warn)).toHaveLength(1);
      expect(collisionLines(debug)).toHaveLength(1);
      expect(collisionLines(warn)[0]?.[0]).toMatchObject({
        parkedAccountId: loserAccount,
        parkedUserId: USER,
        holdingAccountId: INCUMBENT_ACCOUNT,
        holdingUserId: INCUMBENT_USER,
      });
    });

    it("still projects the losing user's other identifiers", async () => {
      await withUserRow();
      await withIncumbentAccountRow();
      const uncontested = `${namespace}-uncontested`;

      await freshStore().store(
        projection(
          {
            [loser]: losingFact(),
            [uncontested]: linkedFact(uncontested, "VERIFIED", {
              accountId: `${namespace}-uncontested-acc`,
              providerAccountId: `${namespace}-free-sub`,
            }),
          },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      // One parked bridge row must not cost the user the rest of theirs:
      // `projectAccounts` iterates every fact, and the catch is per fact.
      expect(
        await prisma.account.findUnique({
          where: { id: `${namespace}-uncontested-acc` },
        }),
      ).toMatchObject({
        userId: USER,
        providerAccountId: `${namespace}-free-sub`,
      });
    });

    it("propagates a P2002 that no incumbent explains", async () => {
      await withUserRow();
      // `Account` carries exactly one unique constraint besides its primary
      // key, so a P2002 the subject probe cannot explain is unreachable
      // against the real schema — and that is precisely why the rethrow
      // needs pinning here: a handler that swallowed every P2002 would eat a
      // future constraint's refusal silently. The client is narrowed to the
      // calls this path makes; the reservations store keeps the real one.
      const refusal = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "test", meta: { target: ["id"] } },
      );
      const refusingPrisma = {
        identifier: { upsert: async () => undefined },
        identityProjectionCursor: { upsert: async () => undefined },
        user: { findUnique: async () => ({ id: USER }) },
        account: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async () => {
            throw refusal;
          },
          findFirst: async () => null,
        },
      } as unknown as PrismaClient;

      await expect(
        new PrismaIdentityProjectionRepository(
          refusingPrisma,
          reservations,
        ).store(
          projection(
            { [loser]: losingFact() },
            { acceptedAt: 10, eventId: "evt_1" },
          ),
          context,
        ),
      ).rejects.toBe(refusal);
    });
  });

  describe("when one user holds two proven identifiers for one address", () => {
    it("writes both, because a sign-in method is not an address claim", async () => {
      await withUserRow();
      const credential = `${namespace}-credential`;
      const google = `${namespace}-google`;

      // A credential sign-in and a Google sign-in are two rows carrying one
      // email, both VERIFIED. Any row-level uniqueness on `value` would
      // forbid the ordinary case; "one USER per proven address" is the
      // address lock's rule, not this table's.
      await repository.store(
        projection(
          {
            [credential]: fact(credential, "VERIFIED"),
            [google]: { ...fact(google, "VERIFIED"), provider: "google" },
          },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      expect(
        await prisma.identifier.count({
          where: { userId: USER, state: "VERIFIED" },
        }),
      ).toBe(2);
    });
  });

  describe("when the fold reconciles the address locks a user holds", () => {
    /** @scenario "Unlinking an address frees it for somebody else" */
    it("releases the lock once no live identifier of theirs carries the value", async () => {
      const id = `${namespace}-locked`;
      const value = `${namespace}@acme.com`;
      await reservations.claim({
        normalizedValue: value,
        userId: USER,
        identifierId: id,
        commandId: "idcmd_1",
      });

      await repository.store(
        projection(
          { [id]: fact(id, "VERIFIED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );
      expect(
        await prisma.identifierReservation.findUnique({
          where: { normalizedValue: value },
        }),
      ).not.toBeNull();

      await repository.store(
        projection(
          { [id]: fact(id, "DETACHED") },
          { acceptedAt: 20, eventId: "evt_2" },
        ),
        context,
      );

      // The address is somebody else's to take now, which is the whole point
      // of releasing rather than keeping a record of who once held it.
      expect(
        await prisma.identifierReservation.findUnique({
          where: { normalizedValue: value },
        }),
      ).toBeNull();
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
