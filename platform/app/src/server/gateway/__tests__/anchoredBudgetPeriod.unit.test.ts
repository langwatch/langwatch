/**
 * @see specs/ai-gateway/budgets.feature
 *
 * Which period an anchored budget row is in, and the floor a spend read for
 * it has to honor. The cycle arithmetic these sit on is exercised next door
 * in anchoredBudgetCycles.unit.test.ts; this file is about what the stored
 * columns of a row mean once the anchor is applied to them.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { explainHandledError } from "~/features/errors/logic/presentation";
import { GatewayBudgetService } from "../budget.service";
import { budgetPeriodFloorMs, effectiveBudgetPeriod } from "../budgetPeriod";

describe("budgetPeriodFloorMs on an anchored budget", () => {
  const anchor = new Date("2026-06-17T09:00:00.000Z");
  const createdAt = new Date("2026-06-17T09:00:00.000Z");

  /** @scenario "An anchored budget floors every read at its own period start" */
  it("floors every read at the anchored period start, reset or not", () => {
    // Unreset: the rollup buckets by calendar month and has no row for a
    // period that starts on the 17th, so the read must take the floor.
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: createdAt,
          lastResetAt: null,
          cycleAnchorAt: anchor,
        },
        new Date("2026-07-15T00:00:00.000Z"),
      ),
    ).toBe(new Date("2026-06-17T09:00:00.000Z").getTime());

    // After the anchored rollover the floor moves with it, so the spend that
    // was counted a moment ago now belongs to the closed period.
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: createdAt,
          lastResetAt: null,
          cycleAnchorAt: anchor,
        },
        new Date("2026-07-20T00:00:00.000Z"),
      ),
    ).toBe(new Date("2026-07-17T09:00:00.000Z").getTime());

    // A future anchor floors at the anchor: nothing has been spent in a
    // period that has not begun.
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: createdAt,
          lastResetAt: null,
          cycleAnchorAt: new Date("2026-09-01T00:00:00.000Z"),
        },
        new Date("2026-08-04T12:00:00.000Z"),
      ),
    ).toBe(new Date("2026-09-01T00:00:00.000Z").getTime());
  });

  /** @scenario "A reset inside an anchored period forgives spend until the next anchored boundary" */
  it("clamps to the reset instant, then expires exactly at the next anchored boundary", () => {
    const resetAt = new Date("2026-07-02T14:00:00.000Z");
    const row = {
      window: "MONTH" as const,
      currentPeriodStartedAt: resetAt,
      lastResetAt: resetAt,
      cycleAnchorAt: anchor,
    };

    // Inside the period the reset opened, the reset instant outranks the
    // anchored start: the forgiven spend stays forgiven.
    expect(budgetPeriodFloorMs(row, new Date("2026-07-10T00:00:00.000Z"))).toBe(
      resetAt.getTime(),
    );
    // One millisecond before the anchored boundary it still holds...
    expect(budgetPeriodFloorMs(row, new Date("2026-07-17T08:59:59.999Z"))).toBe(
      resetAt.getTime(),
    );
    // ...and at the boundary the cycle takes over again, unmoved by the
    // reset. A reset forgives spend; it never re-phases the cycle.
    expect(budgetPeriodFloorMs(row, new Date("2026-07-17T09:00:00.000Z"))).toBe(
      new Date("2026-07-17T09:00:00.000Z").getTime(),
    );
  });

  it("leaves MANUAL on its stored boundary even if an anchor is on the row", () => {
    const boundary = new Date("2026-07-10T09:30:00.000Z");
    expect(
      budgetPeriodFloorMs(
        {
          window: "MANUAL",
          currentPeriodStartedAt: boundary,
          lastResetAt: null,
          cycleAnchorAt: anchor,
        },
        new Date("2026-07-15T12:00:00.000Z"),
      ),
    ).toBe(boundary.getTime());
  });
});

describe("effectiveBudgetPeriod", () => {
  /** @scenario "The reported period is computed at read time, not stored" */
  it("reports the period a budget is in rather than the one its columns claim", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");

    // A calendar budget created in March and never reset: the stored columns
    // still say March, and nothing sweeps them forward. What enforcement
    // reads is the July period, and so is what the wire must say.
    const stale = {
      window: "MONTH" as const,
      currentPeriodStartedAt: new Date("2026-03-05T08:00:00.000Z"),
      resetsAt: new Date("2026-04-01T00:00:00.000Z"),
      lastResetAt: null,
      cycleAnchorAt: null,
    };
    expect(effectiveBudgetPeriod(stale, now)).toEqual({
      currentPeriodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
      resetsAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    // An anchored budget reports its own bounds.
    const anchored = {
      window: "MONTH" as const,
      currentPeriodStartedAt: new Date("2026-06-17T09:00:00.000Z"),
      resetsAt: new Date("2026-07-17T09:00:00.000Z"),
      lastResetAt: null,
      cycleAnchorAt: new Date("2026-06-17T09:00:00.000Z"),
    };
    expect(effectiveBudgetPeriod(anchored, now)).toEqual({
      currentPeriodStartedAt: new Date("2026-06-17T09:00:00.000Z"),
      resetsAt: new Date("2026-07-17T09:00:00.000Z"),
    });

    // A calendar budget reset mid-period reports the reset instant, because
    // that is the bound its spend figure is actually read from.
    const resetAt = new Date("2026-07-10T09:30:00.000Z");
    expect(
      effectiveBudgetPeriod(
        {
          window: "MONTH",
          currentPeriodStartedAt: resetAt,
          resetsAt: new Date("2026-08-01T00:00:00.000Z"),
          lastResetAt: resetAt,
          cycleAnchorAt: null,
        },
        now,
      ),
    ).toEqual({
      currentPeriodStartedAt: resetAt,
      resetsAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    // TOTAL and MANUAL have no boundary to drift past, so their stored pair
    // passes through, sentinel and all.
    const sentinel = new Date(Date.UTC(9999, 11, 31));
    const manualStart = new Date("2026-02-01T00:00:00.000Z");
    for (const window of ["TOTAL", "MANUAL"] as const) {
      expect(
        effectiveBudgetPeriod(
          {
            window,
            currentPeriodStartedAt: manualStart,
            resetsAt: sentinel,
            lastResetAt: null,
            cycleAnchorAt: null,
          },
          now,
        ),
      ).toEqual({
        currentPeriodStartedAt: manualStart,
        resetsAt: sentinel,
      });
    }
  });
});

describe("GatewayBudgetService.create with a cycle anchor", () => {
  const REACHED_TRANSACTION = "REACHED_TRANSACTION";

  function mockPrisma(): PrismaClient {
    return {
      organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
      team: { findFirst: vi.fn().mockResolvedValue(null) },
      project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1" }) },
      modelProvider: { findFirst: vi.fn().mockResolvedValue(null) },
      // Reaching here means the anchor was accepted.
      $transaction: vi.fn().mockRejectedValue(new Error(REACHED_TRANSACTION)),
    } as unknown as PrismaClient;
  }

  const baseInput = {
    organizationId: "org_1",
    scope: { kind: "PROJECT" as const, projectId: "project_1" },
    name: "ACME monthly allowance",
    limitUsd: 100,
    actorUserId: "user_1",
    cycleAnchorAt: new Date("2026-06-17T09:00:00.000Z"),
  };

  /** @scenario "A cycle anchor needs a cyclic window" */
  it("refuses an anchor on the two windows that do not cycle", async () => {
    for (const window of ["TOTAL", "MANUAL"] as const) {
      const sut = GatewayBudgetService.create(mockPrisma());
      // The whole refusal contract, not just the code: the message is what
      // the REST body carries, the fault is what decides whether this is an
      // incident or routine, and meta.window is the caller's own value.
      await expect(sut.create({ ...baseInput, window })).rejects.toMatchObject({
        code: "gateway_budget_cycle_anchor_invalid",
        message: "That window does not cycle, so it cannot take a cycle anchor",
        fault: "customer",
        httpStatus: 400,
        meta: { window: window.toLowerCase() },
      });
    }
  });

  /** @scenario "A cycle anchor needs a cyclic window" */
  it("gives the customer copy that names the two ways out", () => {
    // The words a customer actually reads come from the code-keyed registry,
    // never from the wire message, so the contract is only complete once
    // this side of it is pinned too.
    const explained = explainHandledError({
      code: "gateway_budget_cycle_anchor_invalid",
      message: "That window does not cycle, so it cannot take a cycle anchor",
      fault: "customer",
      meta: { window: "TOTAL" },
    } as never);
    expect(explained.title).toBe("That window can't start on a chosen date");
    expect(explained.description).toContain("total");
    expect(explained.description).toContain("drop the start date");
  });

  it("accepts an anchor on a cyclic window", async () => {
    const sut = GatewayBudgetService.create(mockPrisma());
    await expect(sut.create({ ...baseInput, window: "MONTH" })).rejects.toThrow(
      REACHED_TRANSACTION,
    );
  });

  it("leaves the two non-cycling windows alone when no anchor is sent", async () => {
    for (const window of ["TOTAL", "MANUAL"] as const) {
      const sut = GatewayBudgetService.create(mockPrisma());
      await expect(
        sut.create({ ...baseInput, window, cycleAnchorAt: null }),
      ).rejects.toThrow(REACHED_TRANSACTION);
    }
  });
});
