// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Digest's audience, send and week rows, stated once and run against the memory twins and, when
 * a test database is named at `LANGWATCH_TEST_DATABASE_URL`, the Prisma repositories. The call
 * counter has no Prisma tier (memory and Redis), so it is not stated here.
 */
import { randomUUID } from "node:crypto";

import {
  createTenantId,
  type StateProjectionStore,
  type StoredProjection,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  type PrismaConnection,
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  emptyProjectWeek,
  emptyUserWeek,
  type ProjectWeekState,
  type UserWeekState,
} from "../../rules/digest-week.rules.ts";
import type { DigestAudienceRepository } from "../digest-audience.repository.ts";
import type { DigestSendRepository } from "../digest-send.repository.ts";
import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
  DigestWeekReadRepository,
} from "../digest-week.repository.ts";
import { MemoryDigestAudienceRepository } from "../memory/memory.digest-audience.repository.ts";
import { MemoryDigestSendRepository } from "../memory/memory.digest-send.repository.ts";
import { MemoryDigestWeekRepository } from "../memory/memory.digest-week.repository.ts";
import { PrismaDigestAudienceRepository } from "../prisma/prisma.digest-audience.repository.ts";
import { PrismaDigestProjectWeekRepository } from "../prisma/prisma.digest-project-week.repository.ts";
import { PrismaDigestSendRepository } from "../prisma/prisma.digest-send.repository.ts";
import { PrismaDigestUserWeekRepository } from "../prisma/prisma.digest-user-week.repository.ts";

type Backend = Readonly<{
  name: string;
  audience: () => DigestAudienceRepository;
  sends: () => DigestSendRepository;
  projectWeeks: () => DigestProjectWeekRepository;
  userWeeks: () => DigestUserWeekRepository;
}>;

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection: PrismaConnection | null = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:digest:test:repository-contract"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

const memory: Backend = {
  name: "memory",
  audience: () => MemoryDigestAudienceRepository.create(),
  sends: () => MemoryDigestSendRepository.create(),
  projectWeeks: () => MemoryDigestWeekRepository.create<ProjectWeekState>(),
  userWeeks: () => MemoryDigestWeekRepository.create<UserWeekState>(),
};

const backends: readonly Backend[] = connection
  ? [
      memory,
      {
        name: "Prisma",
        audience: () => PrismaDigestAudienceRepository.create({ prisma: connection.client }),
        sends: () => PrismaDigestSendRepository.create({ prisma: connection.client }),
        projectWeeks: () => PrismaDigestProjectWeekRepository.create({ prisma: connection.client }),
        userWeeks: () => PrismaDigestUserWeekRepository.create({ prisma: connection.client }),
      },
    ]
  : [memory];

// Every case names its own organizations and people, so Postgres runs share no rows.
const organizationIds: string[] = [];
const userIds: string[] = [];
const organization = () => {
  const id = `test-digest-contract-org-${randomUUID()}`;
  organizationIds.push(id);
  return id;
};
const person = () => {
  const id = `test-digest-contract-user-${randomUUID()}`;
  userIds.push(id);
  return id;
};

// The settings row is one per deployment: it is put back as the run found it.
let settingsBefore: { id: string; armed: boolean; lastPlannedWeek: string | null }[] = [];

beforeAll(async () => {
  if (!connection) return;
  settingsBefore = await connection.client.digestSettings.findMany({
    select: { id: true, armed: true, lastPlannedWeek: true },
  });
});

afterAll(async () => {
  if (!connection) return;
  const { client } = connection;
  for (const organizationId of organizationIds) {
    await client.digestCohortOrganization.deleteMany({ where: { organizationId } });
    await client.digestSend.deleteMany({ where: { organizationId } });
    await client.digestProjectWeek.deleteMany({ where: { organizationId } });
    await client.digestUserWeek.deleteMany({ where: { organizationId } });
  }
  for (const userId of userIds) {
    await client.digestSubscription.deleteMany({ where: { userId } });
  }
  for (const { id, ...settings } of settingsBefore) {
    await client.digestSettings.update({ where: { id }, data: settings });
  }
  // A row the run created goes; with none found, that is every row.
  await client.digestSettings.deleteMany({
    where: { id: { notIn: settingsBefore.map(({ id }) => id) } },
  });
  await connection.closeOnce();
});

const AT = Date.parse("2001-05-14T12:00:00Z");

function folded<State>(state: State): StoredProjection<State> {
  return {
    state,
    cursor: { eventId: `event-${randomUUID()}`, acceptedAt: AT },
    occurredAt: AT,
    createdAt: AT,
    updatedAt: AT,
    version: "test",
  };
}

/**
 * One kind of week fold: its repository on a backend, a fold whose `count` marks it, and the
 * scope a read of that organization's folds names (a person's weeks are read by person).
 */
type WeekKind<State, Scope> = Readonly<{
  name: string;
  repository: (
    backend: Backend,
  ) => StateProjectionStore<State> & DigestWeekReadRepository<State, Scope>;
  fold: (input: Readonly<{ organizationId: string; isoWeek: string; count: number }>) => State;
  scopeOf: (organizationId: string) => Scope;
}>;

const projectWeekKind: WeekKind<ProjectWeekState, Readonly<Record<never, never>>> = {
  name: "project",
  repository: (backend) => backend.projectWeeks(),
  scopeOf: () => ({}),
  fold: ({ organizationId, isoWeek, count }) => ({
    ...emptyProjectWeek(),
    projectId: `project-of-${organizationId}`,
    organizationId,
    isoWeek,
    scenarios: { runs: count, passed: 0, failed: 0 },
  }),
};

const userWeekKind: WeekKind<UserWeekState, Readonly<{ userId: string }>> = {
  name: "user",
  repository: (backend) => backend.userWeeks(),
  scopeOf: (organizationId) => ({ userId: `user-of-${organizationId}` }),
  fold: ({ organizationId, isoWeek, count }) => ({
    ...emptyUserWeek(),
    userId: `user-of-${organizationId}`,
    organizationId,
    isoWeek,
    sessionOverflow: count,
  }),
};

/** Stores the fold under its organization's week, as the projection would; answers the key. */
async function storeFold<State extends { organizationId: string; isoWeek: string }>(
  weeks: StateProjectionStore<State>,
  projection: StoredProjection<State>,
): Promise<string> {
  const { organizationId, isoWeek } = projection.state;
  const key = `${organizationId}:${isoWeek}:${randomUUID()}`;
  await weeks.store(projection, {
    aggregateId: key,
    key,
    tenantId: createTenantId(organizationId),
  });
  return key;
}

const byWeek = <State extends { isoWeek: string }>(states: State[]) =>
  states.toSorted((left, right) => left.isoWeek.localeCompare(right.isoWeek));

function weekCases<State extends { organizationId: string; isoWeek: string }, Scope>(
  backend: Backend,
  kind: WeekKind<State, Scope>,
): void {
  describe(`given the ${kind.name} weeks`, () => {
    // Weeks no real fold reaches, at or after the retention test's cutoff, so its sweep keeps them.
    const W30 = "2001-W30";
    const W31 = "2001-W31";
    const W32 = "2001-W32";

    describe("when a fold is stored and read back by its key", () => {
      it("answers the fold as stored, and nothing for a key never stored", async () => {
        const weeks = kind.repository(backend);
        const organizationId = organization();
        const context = { aggregateId: "absent", tenantId: createTenantId(organizationId) };
        const projection = folded(kind.fold({ organizationId, isoWeek: W30, count: 1 }));

        const key = await storeFold(weeks, projection);

        await expect(weeks.get(key, { ...context, key })).resolves.toEqual({
          kind: "folded",
          projection,
        });
        await expect(weeks.get(`absent-${randomUUID()}`, context)).resolves.toEqual({
          kind: "empty",
        });
      });
    });

    describe("when a fold is stored again under its key", () => {
      it("answers the later fold", async () => {
        const weeks = kind.repository(backend);
        const organizationId = organization();
        const first = folded(kind.fold({ organizationId, isoWeek: W30, count: 1 }));
        const key = await storeFold(weeks, first);
        const later = folded(kind.fold({ organizationId, isoWeek: W30, count: 2 }));
        const context = { aggregateId: key, key, tenantId: createTenantId(organizationId) };

        await weeks.store(later, context);

        await expect(weeks.get(key, context)).resolves.toEqual({
          kind: "folded",
          projection: later,
        });
      });
    });

    describe("when one organization's weeks are read", () => {
      it("answers only that organization's folds of the weeks named", async () => {
        const weeks = kind.repository(backend);
        const [mine, other] = [organization(), organization()];
        const stored = [
          kind.fold({ organizationId: mine, isoWeek: W30, count: 1 }),
          kind.fold({ organizationId: mine, isoWeek: W31, count: 2 }),
          kind.fold({ organizationId: mine, isoWeek: W32, count: 3 }),
          kind.fold({ organizationId: other, isoWeek: W30, count: 4 }),
        ];
        for (const state of stored) await storeFold(weeks, folded(state));

        const read = await weeks.findWeeks({
          isoWeeks: [W30, W31],
          organizationId: mine,
          ...kind.scopeOf(mine),
        });

        expect(byWeek(read)).toEqual(stored.slice(0, 2));
      });
    });

    describe("when the weeks before a cutoff are swept", () => {
      // Postgres sweeps every organization: these weeks are older than any other test's rows.
      const BEFORE = "1990-W10";
      const CUTOFF = "1990-W11";
      const AFTER = "1990-W12";

      it("drops the older weeks and keeps the cutoff week and later ones", async () => {
        const weeks = kind.repository(backend);
        const organizationId = organization();
        for (const isoWeek of [BEFORE, CUTOFF, AFTER]) {
          await storeFold(weeks, folded(kind.fold({ organizationId, isoWeek, count: 0 })));
        }

        await weeks.deleteBefore({ isoWeek: CUTOFF });

        const left = await weeks.findWeeks({
          isoWeeks: [BEFORE, CUTOFF, AFTER],
          organizationId,
          ...kind.scopeOf(organizationId),
        });
        expect(byWeek(left).map(({ isoWeek }) => isoWeek)).toEqual([CUTOFF, AFTER]);
      });
    });
  });
}

describe.each(backends)("given the $name digest repositories", (backend) => {
  describe("given opt-outs", () => {
    describe("when a person opts out twice, then resubscribes", () => {
      it("answers them as opted out, then not, and leaves the other person alone", async () => {
        const audience = backend.audience();
        const [optedOut, other] = [person(), person()];

        await audience.unsubscribe({ userId: optedOut, sendId: `${optedOut}:2001-W30`, at: AT });
        await audience.unsubscribe({ userId: optedOut, sendId: `${optedOut}:2001-W31`, at: AT });
        const whileOut = await audience.findUnsubscribed({ userIds: [optedOut, other] });
        await audience.resubscribe({ userId: optedOut });
        await audience.resubscribe({ userId: other });

        expect(whileOut).toEqual([optedOut]);
        expect(await audience.findUnsubscribed({ userIds: [optedOut, other] })).toEqual([]);
      });
    });

    describe("when a person's subscription is forgotten twice", () => {
      it("drops their opt-out and keeps another person's", async () => {
        const audience = backend.audience();
        const [forgotten, kept] = [person(), person()];
        for (const userId of [forgotten, kept]) {
          await audience.unsubscribe({ userId, sendId: `${userId}:2001-W30`, at: AT });
        }

        await audience.forgetUser({ userId: forgotten });
        await audience.forgetUser({ userId: forgotten });

        expect(await audience.findUnsubscribed({ userIds: [forgotten, kept] })).toEqual([kept]);
      });
    });
  });

  describe("given the send's settings", () => {
    describe("when the send is armed, a week planned, then the send disarmed", () => {
      it("keeps each switch as set, and the planned week across a change of arming", async () => {
        const audience = backend.audience();

        await audience.setArmed({ armed: true });
        const armed = await audience.getSettings();
        await audience.markPlanned({ isoWeek: "2001-W30" });
        const planned = await audience.getSettings();
        await audience.setArmed({ armed: false });

        expect(armed.armed).toBe(true);
        expect(planned).toEqual({ armed: true, lastPlannedWeek: "2001-W30" });
        expect(await audience.getSettings()).toEqual({ armed: false, lastPlannedWeek: "2001-W30" });
      });
    });
  });

  describe("given sends", () => {
    describe("when a person's week in one organization is claimed twice", () => {
      it("lets only the first claim through, and another organization's week is its own", async () => {
        const sends = backend.sends();
        const userId = person();
        const [first, second] = [organization(), organization()];
        const claim = { userId, isoWeek: "2001-W30", sentAt: AT } as const;

        const results = [
          await sends.claim({
            ...claim,
            organizationId: first,
            templateId: "digest-week",
          }),
          await sends.claim({ ...claim, organizationId: first, templateId: "digest-week" }),
          await sends.claim({ ...claim, organizationId: second, templateId: "digest-week" }),
        ];

        expect(results).toEqual([true, false, true]);
        expect(await sends.isSent({ userId, organizationId: first, isoWeek: "2001-W30" })).toBe(
          true,
        );
        expect(await sends.isSent({ userId, organizationId: second, isoWeek: "2001-W30" })).toBe(
          true,
        );
        expect(await sends.isSent({ userId, organizationId: first, isoWeek: "2001-W31" })).toBe(
          false,
        );
        expect(
          await sends.isSent({ userId, organizationId: organization(), isoWeek: "2001-W30" }),
        ).toBe(false);
      });
    });

    describe("when a person's sends are forgotten twice", () => {
      it("drops their weeks in every organization and keeps another person's", async () => {
        const sends = backend.sends();
        const [forgotten, kept] = [person(), person()];
        const [first, second] = [organization(), organization()];
        const claimFor = (userId: string, organizationId: string, isoWeek: string) =>
          sends.claim({
            userId,
            organizationId,
            isoWeek,
            templateId: "digest-week",
            sentAt: AT,
          });
        await claimFor(forgotten, first, "2001-W30");
        await claimFor(forgotten, second, "2001-W30");
        await claimFor(kept, first, "2001-W30");

        await sends.forgetUser({ userId: forgotten });
        await sends.forgetUser({ userId: forgotten });

        const isSent = (userId: string, organizationId: string) =>
          sends.isSent({ userId, organizationId, isoWeek: "2001-W30" });
        expect(await isSent(forgotten, first)).toBe(false);
        expect(await isSent(forgotten, second)).toBe(false);
        expect(await isSent(kept, first)).toBe(true);
        expect(await claimFor(forgotten, first, "2001-W30")).toBe(true);
      });
    });
  });

  weekCases(backend, projectWeekKind);
  weekCases(backend, userWeekKind);

  describe("given two people's weeks in one organization", () => {
    describe("when one person's weeks are read", () => {
      it("answers that person's fold alone, never the other member's", async () => {
        const userWeeks = backend.userWeeks();
        const organizationId = organization();
        const [reader, other] = [person(), person()];
        for (const userId of [reader, other]) {
          await storeFold(
            userWeeks,
            folded({
              ...userWeekKind.fold({ organizationId, isoWeek: "2001-W30", count: 1 }),
              userId,
            }),
          );
        }

        const read = await userWeeks.findWeeks({
          isoWeeks: ["2001-W30"],
          organizationId,
          userId: reader,
        });

        expect(read.map(({ userId }) => userId)).toEqual([reader]);
      });
    });
  });

  describe("given a person's weeks in two organizations", () => {
    describe("when the person's weeks are forgotten twice", () => {
      it("drops them in both organizations and keeps another person's", async () => {
        const userWeeks = backend.userWeeks();
        const [first, second] = [organization(), organization()];
        const [forgotten, kept] = [person(), person()];
        const weekOf = (userId: string, organizationId: string) => ({
          ...userWeekKind.fold({ organizationId, isoWeek: "2001-W30", count: 0 }),
          userId,
        });
        for (const state of [weekOf(forgotten, first), weekOf(forgotten, second)]) {
          await storeFold(userWeeks, folded(state));
        }
        await storeFold(userWeeks, folded(weekOf(kept, first)));

        await userWeeks.forgetUser({ userId: forgotten });
        await userWeeks.forgetUser({ userId: forgotten });

        const ownersIn = async (organizationId: string) =>
          (
            await Promise.all(
              [forgotten, kept].map((userId) =>
                userWeeks.findWeeks({ isoWeeks: ["2001-W30"], organizationId, userId }),
              ),
            )
          )
            .flat()
            .map(({ userId }) => userId);
        expect(await ownersIn(first)).toEqual([kept]);
        expect(await ownersIn(second)).toEqual([]);
      });
    });
  });
});
