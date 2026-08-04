/**
 * @vitest-environment node
 *
 * Attributed-user templates, the MANUAL window, and period resets against
 * real Postgres + real ClickHouse: the boundary semantics that make
 * "reset" a boundary move instead of a counter wipe, and the per-budget
 * ledger discipline that lets one request's template row and key-cap row
 * coexist.
 *
 * Spec: specs/ai-gateway/end-user-attribution.feature
 *       specs/ai-gateway/gateway-budget-targeting.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  type BudgetDebitRow,
  GatewayBudgetClickHouseRepository,
} from "../budget.clickhouse.repository";
import { GatewayBudgetService } from "../budget.service";
import { bucketPeriodFloorMs, budgetPeriodFloorMs } from "../budgetPeriod";
import { attributedUserBucketScopeId } from "../budgetResolution.service";
import { anchoredPeriodStart, nextAnchoredResetAt } from "../budgetWindow";

/**
 * A month cycle phased to the 17th at 09:00 UTC: far enough in the past
 * that every run sees it as an established schedule, and on a day no
 * calendar month starts on.
 */
const CYCLE_ANCHOR = new Date("2026-06-17T09:00:00.000Z");

/**
 * Loggers are stubbed so the suppressed-debit report can be asserted;
 * everything else in the observability module stays real.
 */
const capturedLogs = vi.hoisted(() => {
  const stub = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as Record<string, unknown>;
  stub.child = () => stub;
  return stub as typeof stub & { error: ReturnType<typeof vi.fn> };
});
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createLogger: () => capturedLogs };
});

const suffix = nanoid(8);
const ORG_ID = `org-attr-${suffix}`;
const TEAM_ID = `team-attr-${suffix}`;
const PROJECT_ID = `proj-attr-${suffix}`;
const USER_ID = `usr-attr-${suffix}`;
const VK_ID = `vk_attr_${suffix}`;

let chRepo: GatewayBudgetClickHouseRepository;
let service: GatewayBudgetService;

function debitRow(
  over: Partial<BudgetDebitRow> &
    Pick<BudgetDebitRow, "budgetId" | "scopeId" | "gatewayRequestId">,
): BudgetDebitRow {
  return {
    tenantId: PROJECT_ID,
    scope: "ATTRIBUTED_USER",
    window: "MANUAL",
    virtualKeyId: VK_ID,
    providerKey: null,
    amountNanoUsd: 10_000_000_000,
    tokensInput: 100,
    tokensOutput: 50,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model: "gpt-x",
    durationMs: 100,
    status: "SUCCESS",
    occurredAt: new Date(),
    ...over,
  };
}

describe("attributed budgets and resets (real PG + real CH)", () => {
  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Attr Org ${suffix}`, slug: `attr-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Attr Team ${suffix}`,
        slug: `attr-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Attr Project ${suffix}`,
        slug: `attr-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `attr-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@attr.local`, name: "Admin" },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: "tenant-key",
        createdById: USER_ID,
        hashedSecret: `hash-${suffix}`,
        displayPrefix: "vk-lw-attr",
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
    const { getTestClickHouseClient } = await import(
      "~/server/event-sourcing/__tests__/integration/testContainers"
    );
    chRepo = new GatewayBudgetClickHouseRepository(async () => {
      const client = getTestClickHouseClient();
      if (!client) throw new Error("test ClickHouse client unavailable");
      return client;
    });
    service = GatewayBudgetService.create(prisma, chRepo);
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayBudgetBucketBoundary.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  /** @scenario One request's rows for two budgets never suppress each other */
  it("a template row and a key-cap row coexist on one request, and replays stay silent", async () => {
    const template = await service.create({
      organizationId: ORG_ID,
      scope: { kind: "ATTRIBUTED_USER", anchorVirtualKeyId: VK_ID },
      name: "per user",
      window: "MONTH",
      limitUsd: 100,
      actorUserId: USER_ID,
    });
    const other = await service.create({
      organizationId: ORG_ID,
      scope: { kind: "VIRTUAL_KEY", virtualKeyId: VK_ID },
      name: "key cap",
      window: "MONTH",
      limitUsd: 1000,
      actorUserId: USER_ID,
    });
    const requestId = `req-${suffix}-shared`;
    const bucket = attributedUserBucketScopeId(VK_ID, "user-1");

    // The key cap's row lands first.
    await chRepo.insertDebit([
      debitRow({
        budgetId: other.id,
        scope: "VIRTUAL_KEY",
        window: "MONTH",
        scopeId: VK_ID,
        gatewayRequestId: requestId,
      }),
    ]);
    // The same request's template row, against its own bucket.
    await chRepo.insertDebitsForBudgets([
      debitRow({
        budgetId: template.id,
        window: "MONTH",
        scopeId: bucket,
        gatewayRequestId: requestId,
      }),
    ]);
    // A replay of the same row inserts nothing new.
    await chRepo.insertDebitsForBudgets([
      debitRow({
        budgetId: template.id,
        window: "MONTH",
        scopeId: bucket,
        gatewayRequestId: requestId,
        amountNanoUsd: 999_000_000_000,
      }),
    ]);

    const spends = await chRepo.getSpendForTargetsAcrossTenants(
      [PROJECT_ID],
      [
        {
          budgetId: template.id,
          scope: "ATTRIBUTED_USER",
          scopeId: bucket,
          window: "MONTH",
          match: "exact",
        },
        {
          budgetId: other.id,
          scope: "VIRTUAL_KEY",
          scopeId: VK_ID,
          window: "MONTH",
          match: "exact",
        },
      ],
    );
    const byId = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));
    expect(Number.parseFloat(byId.get(template.id)!)).toBeCloseTo(10, 3);
    expect(Number.parseFloat(byId.get(other.id)!)).toBeCloseTo(10, 3);
  });

  /** @scenario A debit that would land in a different bucket is never quiet */
  it("reports a suppressed debit naming a different bucket, and stays silent on a replay", async () => {
    const template = await service.create({
      organizationId: ORG_ID,
      scope: { kind: "ATTRIBUTED_USER", anchorVirtualKeyId: VK_ID },
      name: "collision template",
      window: "MONTH",
      limitUsd: 100,
      actorUserId: USER_ID,
    });
    const requestId = `req-${suffix}-collision`;
    // The bucket a writer with no end-user context can only produce.
    const anchorBucket = VK_ID;
    const perUserBucket = attributedUserBucketScopeId(VK_ID, "user-collide");

    await chRepo.insertDebitsForBudgets([
      debitRow({
        budgetId: template.id,
        window: "MONTH",
        scopeId: anchorBucket,
        gatewayRequestId: requestId,
      }),
    ]);

    // The per-user writer follows, same budget and request, different bucket.
    capturedLogs.error.mockClear();
    await chRepo.insertDebitsForBudgets([
      debitRow({
        budgetId: template.id,
        window: "MONTH",
        scopeId: perUserBucket,
        gatewayRequestId: requestId,
      }),
    ]);

    expect(capturedLogs.error).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayRequestId: requestId,
        budgetId: template.id,
        droppedScopeId: perUserBucket,
        existingScopeId: anchorBucket,
      }),
      expect.stringContaining("different bucket"),
    );

    // A genuine replay of the same writer names the same bucket, which is
    // the idempotency the probe exists for, and must stay quiet.
    capturedLogs.error.mockClear();
    await chRepo.insertDebitsForBudgets([
      debitRow({
        budgetId: template.id,
        window: "MONTH",
        scopeId: anchorBucket,
        gatewayRequestId: requestId,
      }),
    ]);
    expect(capturedLogs.error).not.toHaveBeenCalled();
  });

  /** @scenario Resetting a budget moves the boundary and never the ledger */
  it("reset zeroes the current-period read while every ledger row survives", async () => {
    const manual = await service.create({
      organizationId: ORG_ID,
      scope: { kind: "VIRTUAL_KEY", virtualKeyId: VK_ID },
      name: "manual period",
      window: "MANUAL",
      limitUsd: 500,
      actorUserId: USER_ID,
    });
    const requestId = `req-${suffix}-manual`;
    await chRepo.insertDebit([
      debitRow({
        budgetId: manual.id,
        scope: "VIRTUAL_KEY",
        scopeId: VK_ID,
        gatewayRequestId: requestId,
        amountNanoUsd: 42_000_000_000,
        occurredAt: new Date(),
      }),
    ]);

    const before = await chRepo.getSpendForTargetsAcrossTenants(
      [PROJECT_ID],
      [
        {
          budgetId: manual.id,
          scope: "VIRTUAL_KEY",
          scopeId: VK_ID,
          window: "MANUAL",
          match: "exact",
          periodFloorMs: budgetPeriodFloorMs(manual),
        },
      ],
    );
    expect(Number.parseFloat(before[0]!.spentUsd)).toBeCloseTo(42, 3);

    const ledgerBefore = await chRepo.recentEventsForBudget(
      PROJECT_ID,
      manual.id,
      10,
    );
    const reset = await service.reset({
      id: manual.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      reason: "period close",
    });
    expect(reset.lastResetAt).not.toBeNull();

    const after = await chRepo.getSpendForTargetsAcrossTenants(
      [PROJECT_ID],
      [
        {
          budgetId: manual.id,
          scope: "VIRTUAL_KEY",
          scopeId: VK_ID,
          window: "MANUAL",
          match: "exact",
          periodFloorMs: budgetPeriodFloorMs(reset),
        },
      ],
    );
    expect(Number.parseFloat(after[0]!.spentUsd)).toBe(0);

    const ledgerAfter = await chRepo.recentEventsForBudget(
      PROJECT_ID,
      manual.id,
      10,
    );
    expect(ledgerAfter.length).toBe(ledgerBefore.length);
    expect(ledgerAfter.length).toBeGreaterThan(0);
  });

  /** @scenario Resetting one end-user bucket leaves the template period alone */
  it("per-bucket reset isolates one end user", async () => {
    const template = await service.create({
      organizationId: ORG_ID,
      scope: { kind: "ATTRIBUTED_USER", anchorVirtualKeyId: VK_ID },
      name: "per user manual",
      window: "MANUAL",
      limitUsd: 100,
      actorUserId: USER_ID,
    });
    const bucketA = attributedUserBucketScopeId(VK_ID, "alice");
    const bucketB = attributedUserBucketScopeId(VK_ID, "bob");
    await chRepo.insertDebitsForBudgets([
      debitRow({
        budgetId: template.id,
        scopeId: bucketA,
        gatewayRequestId: `req-${suffix}-alice`,
        amountNanoUsd: 20_000_000_000,
        occurredAt: new Date(),
      }),
    ]);
    await chRepo.insertDebitsForBudgets([
      debitRow({
        budgetId: template.id,
        scopeId: bucketB,
        gatewayRequestId: `req-${suffix}-bob`,
        amountNanoUsd: 30_000_000_000,
        occurredAt: new Date(),
      }),
    ]);

    const templateBefore = await prisma.gatewayBudget.findUnique({
      where: { id: template.id },
    });
    await service.reset({
      id: template.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      endUserId: "alice",
    });
    const templateAfter = await prisma.gatewayBudget.findUnique({
      where: { id: template.id },
    });
    expect(templateAfter!.currentPeriodStartedAt.getTime()).toBe(
      templateBefore!.currentPeriodStartedAt.getTime(),
    );

    const boundary = await prisma.gatewayBudgetBucketBoundary.findUnique({
      where: {
        budgetId_bucketScopeId: {
          budgetId: template.id,
          bucketScopeId: bucketA,
        },
      },
    });
    expect(boundary).not.toBeNull();

    const read = async (bucket: string, floorMs?: number) => {
      const spends = await chRepo.getSpendForTargetsAcrossTenants(
        [PROJECT_ID],
        [
          {
            budgetId: template.id,
            scope: "ATTRIBUTED_USER",
            scopeId: bucket,
            window: "MANUAL",
            match: "exact",
            periodFloorMs: floorMs ?? budgetPeriodFloorMs(templateAfter!),
          },
        ],
      );
      return Number.parseFloat(spends[0]!.spentUsd);
    };
    expect(await read(bucketA, boundary!.periodStartedAt.getTime())).toBe(0);
    expect(await read(bucketB)).toBeCloseTo(30, 3);
  });

  /** @scenario "Resetting an anchored budget rejoins the anchor schedule" */
  it("forgives the current period's spend without re-phasing the cycle", async () => {
    const anchored = await service.create({
      organizationId: ORG_ID,
      scope: { kind: "VIRTUAL_KEY", virtualKeyId: VK_ID },
      name: "anchored month",
      window: "MONTH",
      limitUsd: 500,
      cycleAnchorAt: CYCLE_ANCHOR,
      actorUserId: USER_ID,
    });
    expect(anchored.cycleAnchorAt?.toISOString()).toBe(
      CYCLE_ANCHOR.toISOString(),
    );
    // Created mid-cycle, it reports the anchor's next boundary rather than
    // one month from the creation instant.
    expect(anchored.resetsAt.toISOString()).toBe(
      nextAnchoredResetAt({
        window: "MONTH",
        anchorAt: CYCLE_ANCHOR,
        now: anchored.createdAt,
      }).toISOString(),
    );

    const readAt = async (budget: typeof anchored, now: Date) => {
      const spends = await chRepo.getSpendForTargetsAcrossTenants(
        [PROJECT_ID],
        [
          {
            budgetId: budget.id,
            scope: "VIRTUAL_KEY",
            scopeId: VK_ID,
            window: "MONTH",
            match: "exact",
            periodFloorMs: budgetPeriodFloorMs(budget, now),
          },
        ],
        now,
      );
      return Number.parseFloat(spends[0]!.spentUsd);
    };

    // A debit inside the anchored period that was open at creation.
    const spentAt = new Date(anchored.createdAt.getTime() - 60_000);
    await chRepo.insertDebit([
      debitRow({
        budgetId: anchored.id,
        scope: "VIRTUAL_KEY",
        window: "MONTH",
        scopeId: VK_ID,
        gatewayRequestId: `req-${suffix}-anchored`,
        amountNanoUsd: 42_000_000_000,
        occurredAt: spentAt,
      }),
    ]);
    expect(await readAt(anchored, anchored.createdAt)).toBeCloseTo(42, 3);

    const reset = await service.reset({
      id: anchored.id,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      reason: "goodwill credit",
    });
    expect(reset.lastResetAt).not.toBeNull();

    // The spend is forgiven immediately...
    expect(await readAt(reset, reset.lastResetAt!)).toBe(0);

    // ...and the reported boundary is the anchor's next one, not one month
    // from the reset. A reset is a credit, not a re-phasing.
    expect(reset.resetsAt.toISOString()).toBe(
      nextAnchoredResetAt({
        window: "MONTH",
        anchorAt: CYCLE_ANCHOR,
        now: reset.lastResetAt!,
      }).toISOString(),
    );

    // Once that boundary passes, the floor is the anchored period start
    // again: the reset's clamp expires exactly there rather than carrying a
    // private boundary forward forever.
    const afterRollover = new Date(reset.resetsAt.getTime() + 1000);
    expect(budgetPeriodFloorMs(reset, afterRollover)).toBe(
      anchoredPeriodStart({
        window: "MONTH",
        anchorAt: CYCLE_ANCHOR,
        now: afterRollover,
      }).getTime(),
    );
    expect(budgetPeriodFloorMs(reset, afterRollover)).toBe(
      reset.resetsAt.getTime(),
    );
  });

  it("floors an anchored per-seat template's bucket read at the anchored period start", async () => {
    const template = await service.create({
      organizationId: ORG_ID,
      scope: { kind: "ATTRIBUTED_USER", anchorVirtualKeyId: VK_ID },
      name: "anchored per user",
      window: "MONTH",
      limitUsd: 100,
      cycleAnchorAt: CYCLE_ANCHOR,
      actorUserId: USER_ID,
    });
    const bucket = attributedUserBucketScopeId(VK_ID, `seat-${suffix}`);
    const now = new Date("2026-07-15T18:00:00.000Z");
    const periodStart = anchoredPeriodStart({
      window: "MONTH",
      anchorAt: CYCLE_ANCHOR,
      now,
    });

    // One debit either side of the anchored period start, both inside the
    // July calendar month the rollup would have keyed them under.
    await chRepo.insertDebit([
      debitRow({
        budgetId: template.id,
        scopeId: bucket,
        window: "MONTH",
        gatewayRequestId: `req-${suffix}-seat-before`,
        amountNanoUsd: 7_000_000_000,
        occurredAt: new Date(periodStart.getTime() - 3_600_000),
      }),
    ]);
    await chRepo.insertDebit([
      debitRow({
        budgetId: template.id,
        scopeId: bucket,
        window: "MONTH",
        gatewayRequestId: `req-${suffix}-seat-inside`,
        amountNanoUsd: 5_000_000_000,
        occurredAt: new Date(periodStart.getTime() + 3_600_000),
      }),
    ]);

    const spends = await chRepo.getSpendForTargetsAcrossTenants(
      [PROJECT_ID],
      [
        {
          budgetId: template.id,
          scope: "ATTRIBUTED_USER",
          scopeId: bucket,
          window: "MONTH",
          match: "exact",
          periodFloorMs: bucketPeriodFloorMs(template, null, now),
        },
      ],
      now,
    );
    // Only the debit inside the anchored period. The bucket floor is the
    // budget's own, since this seat has no boundary row of its own.
    expect(Number.parseFloat(spends[0]!.spentUsd)).toBeCloseTo(5, 3);
    expect(bucketPeriodFloorMs(template, null, now)).toBe(
      periodStart.getTime(),
    );
  });
});
