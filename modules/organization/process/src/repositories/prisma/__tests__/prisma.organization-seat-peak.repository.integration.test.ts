/**
 * @vitest-environment node
 * @see modules/organization/specs/seat-peak.feature
 * The seat peak stored as rows (ADR-002 §2): folding through the tables, one slice at a time,
 * gives what folding every fact over the whole state gives, and a change writes only its rows.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import type { SeatHolder, SeatKind } from "../../../rules/seat-holder.rules.ts";
import {
  emptySeatPeak,
  foldSeatPeak,
  type SeatPeakFact,
  seatPeakAsOf,
} from "../../../rules/seat-peak.rules.ts";
import { PrismaOrganizationSeatPeakRepository } from "../prisma.organization-seat-peak.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

function at(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

const OCT_20 = at("2026-10-20T09:00:00Z");
const NOV_1 = at("2026-11-01T09:00:00Z");
const NOV_2 = at("2026-11-02T09:00:00Z");
const NOV_5 = at("2026-11-05T09:00:00Z");
const NOV_9 = at("2026-11-09T09:00:00Z");
const DEC_3 = at("2026-12-03T09:00:00Z");

describe.skipIf(!DB_URL)("organization's seat peak rows (Postgres)", () => {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:seat-peak-rows"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const peaks = PrismaOrganizationSeatPeakRepository.create(prisma);
  const organizationIds: string[] = [];

  function organization(): string {
    const id = `org-seat-peak-${nanoid(10)}`;
    organizationIds.push(id);
    return id;
  }

  function snapshot({
    organizationId,
    occurredAt,
    holders,
  }: {
    organizationId: string;
    occurredAt: number;
    holders: { holder: SeatHolder; seat: SeatKind }[];
  }): SeatPeakFact {
    return {
      type: "seat_snapshot_taken",
      data: { tenantId: organizationId, organizationId, occurredAt, holders },
    };
  }

  function change({
    organizationId,
    holder,
    from,
    to,
    occurredAt,
  }: {
    organizationId: string;
    holder: SeatHolder;
    from: SeatKind;
    to: SeatKind;
    occurredAt: number;
  }): SeatPeakFact {
    return {
      type: "seat_changed",
      data: {
        tenantId: organizationId,
        organizationId,
        holder,
        from,
        to,
        cause: "admitted",
        actorUserId: null,
        occurredAt,
        changeId: `change-${nanoid(8)}`,
      },
    };
  }

  /** What the fold subscriber does with one fact: load its slice, fold, write what moved. */
  async function foldThroughRows({
    organizationId,
    fact,
  }: {
    organizationId: string;
    fact: SeatPeakFact;
  }): Promise<void> {
    await peaks.update(
      {
        organizationId,
        holders: fact.type === "seat_changed" ? [fact.data.holder] : [],
        dueBefore: fact.data.occurredAt,
      },
      (state) => foldSeatPeak({ state, fact }),
    );
  }

  afterAll(async () => {
    const where = { organizationId: { in: organizationIds } };
    await prisma.organizationSeatPeakHolder.deleteMany({ where });
    await prisma.organizationSeatPeakMonth.deleteMany({ where });
    await prisma.organizationSeatPeak.deleteMany({ where });
    await prisma.$disconnect();
  });

  describe("given an organization's changes over two months, some arriving late", () => {
    /** @scenario "Rebuilding the count from the recorded changes gives the same peaks" */
    it("stores the counts and every month's peaks the whole-state fold gives", async () => {
      const organizationId = organization();
      const member = (userId: string): SeatHolder => ({ kind: "member", userId });
      const invitation = (inviteId: string, expiresAt: number): SeatHolder => ({
        kind: "invitation",
        inviteId,
        expiresAt,
      });
      const facts: SeatPeakFact[] = [
        snapshot({
          organizationId,
          occurredAt: OCT_20,
          holders: [
            ...Array.from({ length: 5 }, (_, i) => ({
              holder: member(`m-${i}`),
              seat: "full" as const,
            })),
            { holder: member("lite-0"), seat: "lite" },
            { holder: invitation("inv-expiring", NOV_5), seat: "full" },
          ],
        }),
        change({
          organizationId,
          holder: member("joiner"),
          from: "none",
          to: "full",
          occurredAt: NOV_1,
        }),
        change({
          organizationId,
          holder: member("m-0"),
          from: "full",
          to: "none",
          occurredAt: NOV_2,
        }),
        change({
          organizationId,
          holder: member("lite-0"),
          from: "lite",
          to: "full",
          occurredAt: NOV_9,
        }),
        // Arrives after December's change, dated in November.
        change({
          organizationId,
          holder: member("late"),
          from: "none",
          to: "full",
          occurredAt: DEC_3,
        }),
        change({
          organizationId,
          holder: member("m-1"),
          from: "full",
          to: "none",
          occurredAt: NOV_9 + 1,
        }),
      ];

      for (const fact of facts) await foldThroughRows({ organizationId, fact });

      const whole = facts.reduce((state, fact) => foldSeatPeak({ state, fact }), emptySeatPeak());
      const stored = await peaks.getState({ organizationId, holders: [], dueBefore: DEC_3 + 1 });
      const now = DEC_3 + 1;
      expect(seatPeakAsOf({ state: stored, now })).toEqual(seatPeakAsOf({ state: whole, now }));
      expect(stored.counts).toEqual(whole.counts);
      expect(stored.mismatches).toBe(whole.mismatches);
    });
  });

  describe("given an organization of many members", () => {
    it("writes only the moved holder's row for one change", async () => {
      const organizationId = organization();
      const holders = Array.from({ length: 500 }, (_, i) => ({
        holder: { kind: "member" as const, userId: `m-${i}` },
        seat: "full" as const,
      }));
      await foldThroughRows({
        organizationId,
        fact: snapshot({ organizationId, occurredAt: NOV_1, holders }),
      });
      const before = await prisma.organizationSeatPeakHolder.findMany({
        where: { organizationId },
        orderBy: { holderId: "asc" },
      });

      await foldThroughRows({
        organizationId,
        fact: change({
          organizationId,
          holder: { kind: "member", userId: "m-7" },
          from: "full",
          to: "lite",
          occurredAt: NOV_2,
        }),
      });

      const after = await prisma.organizationSeatPeakHolder.findMany({
        where: { organizationId },
        orderBy: { holderId: "asc" },
      });
      expect(after).toHaveLength(500);
      const moved = after.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before[i]));
      expect(moved).toEqual([expect.objectContaining({ holderId: "m-7", seat: "lite" })]);
      const state = await peaks.getState({ organizationId, holders: [], dueBefore: NOV_2 });
      expect(state.counts).toEqual({ full: 499, lite: 1, developer: 0 });
      expect(state.members).toEqual({});
    });
  });

  describe("given the same change delivered twice", () => {
    /** @scenario "A seat change delivered twice is counted once" */
    it("counts it once", async () => {
      const organizationId = organization();
      await foldThroughRows({
        organizationId,
        fact: snapshot({ organizationId, occurredAt: NOV_1, holders: [] }),
      });
      const joined = change({
        organizationId,
        holder: { kind: "member", userId: "joiner" },
        from: "none",
        to: "full",
        occurredAt: NOV_2,
      });

      await foldThroughRows({ organizationId, fact: joined });
      await foldThroughRows({ organizationId, fact: joined });

      const state = await peaks.getState({ organizationId, holders: [], dueBefore: NOV_2 });
      expect(state.counts.full).toBe(1);
      expect(state.months["2026-11"]).toMatchObject({ fullPeak: 1, fullAtEnd: 1 });
    });
  });

  describe("given a stored holder whose seat is not a seat kind", () => {
    it("throws rather than reading it as no seat", async () => {
      const organizationId = organization();
      const member = { kind: "member" as const, userId: "odd" };
      await foldThroughRows({
        organizationId,
        fact: snapshot({
          organizationId,
          occurredAt: NOV_1,
          holders: [{ holder: member, seat: "full" }],
        }),
      });
      await prisma.organizationSeatPeakHolder.updateMany({
        where: { organizationId, holderId: "odd" },
        data: { seat: "platinum" },
      });

      await expect(
        peaks.getState({ organizationId, holders: [member], dueBefore: NOV_2 }),
      ).rejects.toThrow(/unknown seat "platinum"/);
    });
  });
});
