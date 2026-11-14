// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/licensing/seat-rotation.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SeatLineClaim } from "../../seat-event-subscription.repository.ts";
import { PrismaSeatEventSubscriptionRepository } from "../prisma.seat-event-subscription.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaSeatEventSubscriptionRepository seat line repairs", () => {
  const run = `seat_repair_${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:seat-line-repair"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const subscriptions = PrismaSeatEventSubscriptionRepository.create(prisma);
  let organizationId = "";

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${run}` },
    });
    organizationId = organization.id;
  });

  const seed = async (suffix: string) => {
    const id = `${run}_${suffix}`;
    await prisma.subscription.create({
      data: {
        id,
        organizationId,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        status: "ACTIVE",
        stripeSubscriptionId: `${id}_stripe`,
        maxMembers: 3,
      },
    });
    return id;
  };
  /** Every repair of this run, however young. */
  const pendingOfRun = async () =>
    (
      await subscriptions.findSeatRepairs({
        recordedBefore: Temporal.Now.instant().add({ hours: 1 }),
      })
    ).filter((row) => row.id.startsWith(run));

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  /** @scenario "A seat line Stripe refused to put back is recorded for repair" */
  it("records a repair, counts its failures with the Ops flag, and clears it", async () => {
    const id = await seed("lifecycle");

    const record = await subscriptions.recordSeatRepair({ id, quantity: 3, liftedQuantity: 5 });
    expect(await pendingOfRun()).toEqual([
      {
        id,
        organizationId,
        stripeSubscriptionId: `${id}_stripe`,
        quantity: 3,
        liftedQuantity: 5,
        since: record.since,
        attempts: 0,
        flaggedAt: null,
      },
    ]);
    expect(await subscriptions.isSeatRepairPending({ id, record })).toBe(true);

    const flaggedAt = Temporal.Instant.from("2026-11-06T12:00:00Z");
    await subscriptions.recordSeatRepairFailure({ id, record, attempts: 5, flaggedAt });
    expect(await pendingOfRun()).toEqual([expect.objectContaining({ id, attempts: 5, flaggedAt })]);

    await subscriptions.clearSeatRepair({ id, record });
    expect(await pendingOfRun()).toEqual([]);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({
      seatRepairQuantity: null,
      seatRepairLiftedQuantity: null,
      seatRepairSince: null,
      seatRepairAttempts: null,
      seatRepairFlaggedAt: null,
    });
  });

  /** @scenario "A seat line repair waits out a change that may still be running" */
  it("lists only repairs recorded before the given instant", async () => {
    const id = await seed("young");

    const record = await subscriptions.recordSeatRepair({ id, quantity: 3, liftedQuantity: 5 });

    const before = await subscriptions.findSeatRepairs({ recordedBefore: record.since });
    expect(before.filter((row) => row.id === id)).toEqual([]);
    await subscriptions.clearSeatRepair({ id, record });
  });

  /** @scenario "A seat line a later change moved is left alone" */
  it("keeps a newer repair when an older pass clears, and a seat change clears older ones", async () => {
    const id = await seed("newer");

    const older = await subscriptions.recordSeatRepair({ id, quantity: 3, liftedQuantity: 5 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await subscriptions.recordSeatRepair({ id, quantity: 4, liftedQuantity: 6 });
    await subscriptions.clearSeatRepair({ id, record: older });
    await subscriptions.recordSeatRepairFailure({
      id,
      record: older,
      attempts: 9,
      flaggedAt: null,
    });
    expect(await subscriptions.isSeatRepairPending({ id, record: older })).toBe(false);
    expect(await pendingOfRun()).toEqual([
      expect.objectContaining({ id, quantity: 4, liftedQuantity: 6, attempts: 0 }),
    ]);

    await subscriptions.reactivateWithSeats({
      id,
      maxMembers: 4,
      kept: null,
      repairsUpTo: older.since,
    });
    expect(await pendingOfRun()).toEqual([expect.objectContaining({ id, quantity: 4 })]);

    await subscriptions.reactivateWithSeats({
      id,
      maxMembers: 4,
      kept: null,
      repairsUpTo: newer.since,
    });
    expect(await pendingOfRun()).toEqual([]);
  });

  /** @scenario "The seat line quantity a pending write settles to ignores the provider's own updates" */
  it("records writes ahead under the lease and reads the seat change's count as the target", async () => {
    const id = await seed("write-ahead");
    expect(await subscriptions.findSeatLineTarget({ id })).toEqual({ quantity: 3, at: null });

    await subscriptions.reactivateWithSeats({
      id,
      maxMembers: 6,
      kept: null,
      repairsUpTo: Temporal.Now.instant(),
    });
    // A provider update event writes maxMembers only; the target stays the change's count.
    await prisma.subscription.update({ where: { id }, data: { maxMembers: 3 } });
    expect(await subscriptions.findSeatLineTarget({ id })).toMatchObject({ quantity: 6 });

    const first = await subscriptions.claimSeatLine({ id, leaseMs: 60_000 });
    if (!first.claimed) throw new Error("expected the lease");
    const opened = await subscriptions.beginSeatLineWrite({
      id,
      token: first.token,
      leaseMs: 60_000,
      quantity: 4,
    });
    if (!opened.held || !opened.opened) throw new Error("expected an opened write");
    const kept = await subscriptions.beginSeatLineWrite({
      id,
      token: first.token,
      leaseMs: 60_000,
      quantity: 5,
    });
    expect(kept).toEqual({ held: true, opened: null });
    expect(
      await subscriptions.beginSeatLineWrite({ id, token: "other", leaseMs: 60_000, quantity: 7 }),
    ).toEqual({ held: false });
    expect(await subscriptions.findSeatLineWrite({ id })).toMatchObject({
      quantities: [4, 5],
      since: opened.opened,
    });
    expect(
      await subscriptions.finishSeatLineWrite({ id, token: "other", opened: opened.opened }),
    ).toBe(false);
    expect(
      await subscriptions.finishSeatLineWrite({ id, token: first.token, opened: opened.opened }),
    ).toBe(true);
    expect(await subscriptions.findSeatLineWrite({ id })).toBeNull();
    await subscriptions.releaseSeatLine({ id, token: first.token });
  });

  /** @scenario "A seat line repair skips a subscription a seat change is working on" */
  it("lets one holder take, renew and release the seat line until the lease runs out", async () => {
    const id = await seed("lease");
    const tokenOf = (claim: SeatLineClaim) => {
      if (!claim.claimed) throw new Error("the seat line was not claimed");
      return claim.token;
    };

    const first = tokenOf(await subscriptions.claimSeatLine({ id, leaseMs: 60_000 }));
    expect(await subscriptions.claimSeatLine({ id, leaseMs: 60_000 })).toEqual({ claimed: false });
    expect(await subscriptions.renewSeatLine({ id, token: first, leaseMs: 60_000 })).toBe(true);
    expect(await subscriptions.renewSeatLine({ id, token: "other", leaseMs: 60_000 })).toBe(false);
    await subscriptions.releaseSeatLine({ id, token: "other" });
    expect(await subscriptions.claimSeatLine({ id, leaseMs: 60_000 })).toEqual({ claimed: false });

    await subscriptions.releaseSeatLine({ id, token: first });
    const expiring = tokenOf(await subscriptions.claimSeatLine({ id, leaseMs: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await subscriptions.renewSeatLine({ id, token: expiring, leaseMs: 60_000 })).toBe(false);
    expect((await subscriptions.claimSeatLine({ id, leaseMs: 60_000 })).claimed).toBe(true);
  });
});
