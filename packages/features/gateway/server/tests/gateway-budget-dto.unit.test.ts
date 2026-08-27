/**
 * @vitest-environment node
 *
 * @see specs/ai-gateway/public-rest-api.feature
 */

import { describe, expect, it } from "vitest";
import { Prisma } from "@langwatch/prisma-client/generated";
import { decimalUsdToNanoUsd, toBudgetDto, type GatewayBudgetWithSeats } from "../src";

function budget(overrides: Partial<GatewayBudgetWithSeats> = {}): GatewayBudgetWithSeats {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    id: "bgt_1",
    organizationId: "org_1",
    scopeType: "VIRTUAL_KEY",
    scopeId: "vk_1",
    providerKey: null,
    name: "cap",
    description: null,
    window: "MONTH",
    limitUsd: new Prisma.Decimal("25.500000"),
    onBreach: "BLOCK",
    timezone: null,
    spentUsd: new Prisma.Decimal("3.210000"),
    currentPeriodStartedAt: now,
    resetsAt: now,
    lastResetAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdById: "usr_1",
    managedByVirtualKeyId: null,
    ...overrides,
  } as GatewayBudgetWithSeats;
}

describe("decimalUsdToNanoUsd", () => {
  /** @scenario A budget amount converts to nano-USD without float drift */
  it("scales the decimal string exactly", () => {
    // 0.1 + 0.2 arithmetic is why this scales the STRING: `toNumber() * 1e9`
    // on these lands fractions of a cent away from the true integer.
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("25.500000"))).toBe(25_500_000_000);
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("0.000001"))).toBe(1_000);
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("0.070000"))).toBe(70_000_000);
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("0"))).toBe(0);
  });

  /** @scenario An amount past the safe integer range reports no nano figure */
  it("returns null rather than a silently rounded number", () => {
    // Past 2^53 nano-USD a JSON number has already lost the low digits, and a
    // wrong money figure is worse than an absent one.
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("9007199.254740991"))).toBe(
      9_007_199_254_740_991,
    );
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("10000000"))).toBeNull();
  });
});

describe("toBudgetDto", () => {
  /** @scenario Every enum a budget read returns is lowercase */
  it("publishes the wire casing and both money units", () => {
    expect(toBudgetDto({ budget: budget() })).toMatchObject({
      scope_type: "virtual_key",
      window: "month",
      on_breach: "block",
      limit_usd: "25.5",
      limit_nano_usd: 25_500_000_000,
      spent_usd: "3.21",
      spent_nano_usd: 3_210_000_000,
    });
  });

  /** @scenario Spend that could not be totalled is null, never a stale figure */
  it("nulls both spend fields when spend is unavailable", () => {
    const dto = toBudgetDto({ budget: budget(), spendAvailable: false });
    expect(dto.spent_usd).toBeNull();
    expect(dto.spent_nano_usd).toBeNull();
    // The limit is a stored setting, not a measurement, so it still reads.
    expect(dto.limit_usd).toBe("25.5");
    expect(dto.limit_nano_usd).toBe(25_500_000_000);
  });

  /** @scenario "A budget and its spend events report the same integer" */
  it("publishes the ledger's integer and renders the string from it", () => {
    // A cost of 73950 nano is not a whole microdollar, so a decimal carrying
    // six places cannot hold it. Taking the integer from the ledger is what
    // makes the published figure the one the spend events also publish;
    // deriving it from `spentUsd` would republish the rounding instead.
    const dto = toBudgetDto({
      budget: budget({
        spentNanoUsd: 73_950,
        spentUsd: new Prisma.Decimal("0.000074"),
      }),
    });
    expect(dto.spent_nano_usd).toBe(73_950);
    expect(dto.spent_usd).toBe("0.00007395");
  });

  /** @scenario "A per-person template reports no total of its own" */
  it("nulls the spend fields on a per-person template", () => {
    const dto = toBudgetDto({
      budget: budget({
        scopeType: "ATTRIBUTED_USER",
        spentNanoUsd: 73_950,
        endUsersSeen: 12,
        endUsersOver: 3,
      }),
    });
    // One allowance per person has no single total, so any number here is a
    // confident answer to a question the row cannot answer.
    expect(dto.spent_usd).toBeNull();
    expect(dto.spent_nano_usd).toBeNull();
    // What the row CAN say, it still says.
    expect(dto.end_users_seen).toBe(12);
    expect(dto.end_users_over).toBe(3);
    expect(dto.limit_usd).toBe("25.5");
  });

  /** @scenario Per-person and per-member fields appear only on their scopes */
  it("carries the seat fields only when the scope has them", () => {
    expect(toBudgetDto({ budget: budget() })).not.toHaveProperty("end_users_seen");
    expect(toBudgetDto({ budget: budget(), memberCount: 4 })).toMatchObject({
      member_count: 4,
    });
    expect(
      toBudgetDto({ budget: budget({ endUsersSeen: 7, endUsersOver: 2 }) }),
    ).toMatchObject({ end_users_seen: 7, end_users_over: 2 });
  });
});
