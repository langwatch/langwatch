/**
 * @vitest-environment node
 *
 * Two budgets on one key each report what the request cost, not what the two
 * of them recorded between them.
 *
 * Real Postgres + real ClickHouse, no mocks on the read: spend is written to
 * the real ledger and read back through the real repository and service, so
 * this covers the path enforcement runs on: debit -> ledger -> rollup ->
 * decision.
 *
 * The ledger writes one row per (budget, request), so a request resolving a
 * hard cap and a soft cap on the same virtual key writes two rows carrying the
 * same cost. Reads that identified a budget's rows by scope alone summed both
 * into each budget, and the rollup, keyed without the budget, folded them into
 * one aggregate that could not be unpicked afterwards. Every budget then
 * reported N times its true spend for N budgets sharing its bucket: a $5.00
 * cap refusing traffic at $2.50, an 80% warning firing at 40%. A hard cap and
 * a soft cap on one key is the standard way to provision one, so this is the
 * shape that has to stay correct.
 *
 * Spec: specs/ai-gateway/budgets.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";

import { budgetAppliesToProvider } from "../../adapters/gateway-bucket-scope.adapter";
import { NANO_USD_PER_USD } from "../../adapters/model-catalog.gateway-spend-rating.adapter";
import { PrismaGatewayAdapter } from "../../adapters/prisma.gateway.adapter";
import { GatewayBudgetClickHouseRepository } from "../../repositories/clickhouse/clickhouse.gateway-budget.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support";
import type { GatewayService } from "../gateway.service";
import { TestProjectService } from "./support/test-project-service";

/**
 * The tenancy guard names a project on every query. This suite writes the
 * organizations and projects it then reads, so it composes the client without
 * one rather than teaching the guard about rows that do not exist yet.
 */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const chUrl = testClickHouseUrl();
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);
const ORG_ID = `org-sib-${suffix}`;
const TEAM_ID = `team-sib-${suffix}`;
const PROJECT_ID = `proj-sib-${suffix}`;
const USER_ID = `usr-sib-${suffix}`;

/**
 * The spend fan-out the list view reads: this suite's one project. Assigned
 * onto the contract fake rather than subclassed, because the fake's stand-in
 * for this method is typed by its own empty answer.
 */
const projects: ProjectService = Object.assign(new TestProjectService(), {
  listIdsByOrganization: () => Promise.resolve([PROJECT_ID]),
});

/** One key per scenario, so no scenario can spend against another's budgets. */
const PAIR_VK = `vk_sib_pair_${suffix}`;
const TRIO_VK = `vk_sib_trio_${suffix}`;
const WINDOWS_VK = `vk_sib_win_${suffix}`;
const MANUAL_VK = `vk_sib_man_${suffix}`;
const SEATS_VK = `vk_sib_seat_${suffix}`;
const ANCHOR_VK = `vk_sib_anch_${suffix}`;

/**
 * A month cycle anchored to the 17th, and the two instants that tell the
 * anchored budget apart from the calendar one: the first sits inside the
 * anchored period that opened on 17 June, the second after it rolled on
 * 17 July. A debit on 20 June is in neither July calendar month.
 */
const CYCLE_ANCHOR = new Date("2026-06-17T09:00:00.000Z");
const BACKDATED_DEBIT_AT = new Date("2026-06-20T00:00:00.000Z");
const FRESH_DEBIT_AT = new Date("2026-07-15T12:00:00.000Z");
const INSIDE_ANCHORED_PERIOD = new Date("2026-07-15T18:00:00.000Z");
const AFTER_ANCHORED_ROLLOVER = new Date("2026-07-20T00:00:00.000Z");

const COST_USD = 0.001;
/** Above one request, at or below two. One request must not breach it. */
const TIGHT_LIMIT_USD = "0.0015";
const LOOSE_LIMIT_USD = "5";

let service: GatewayService;
let chRepo: GatewayBudgetClickHouseRepository;

/** One served request, as the spend pipeline reports it. */
type ServedRequest = {
  virtualKeyId: string;
  endUserId?: string;
  /** When the request was served. Defaults to now. */
  occurredAt?: Date;
};

/**
 * The debit burst one served request writes: every budget the request
 * resolves gets its own ledger row, carrying that request's whole cost.
 *
 * The enterprise debits process manager owns this shape in production. It
 * lives in a package a gateway suite may not depend on, so the fan-out is
 * spelled out here over the same resolver and the same repository it calls —
 * the read under test is downstream of both either way.
 */
async function writeDebits(request: ServedRequest): Promise<void> {
  const providerKey = null;
  const budgets = (
    await service.resolveApplicableBudgets({
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      virtualKeyId: request.virtualKeyId,
      principalUserId: USER_ID,
      endUserId: request.endUserId ?? null,
    })
  ).filter((resolved) => budgetAppliesToProvider(resolved.budget, providerKey));
  if (budgets.length === 0) throw new Error("the request resolved no budgets");

  const gatewayRequestId = `grq_${nanoid()}`;
  await chRepo.insertDebit(
    budgets.map(({ budget, bucketScopeId }) => ({
      tenantId: PROJECT_ID,
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: bucketScopeId,
      window: budget.window,
      virtualKeyId: request.virtualKeyId,
      providerKey,
      gatewayRequestId,
      amountNanoUsd: COST_USD * NANO_USD_PER_USD,
      tokensInput: 300,
      tokensOutput: 150,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: "gpt-5-mini",
      durationMs: 120,
      status: "SUCCESS" as const,
      occurredAt: request.occurredAt ?? new Date(),
    })),
  );
}

async function createVirtualKey(id: string): Promise<void> {
  await prisma.virtualKey.create({
    data: {
      id,
      organizationId: ORG_ID,
      name: id,
      hashedSecret: `hash-${id}`,
      displayPrefix: "vk-lw-xxxxxxx",
      principalUserId: USER_ID,
      createdById: USER_ID,
      // The destination is stored on the key rather than taken from its
      // scope, so a row written straight to PG has to carry it.
      traceProjectId: PROJECT_ID,
      scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
    },
  });
}

async function createBudget(input: {
  id: string;
  virtualKeyId: string;
  window: "DAY" | "MONTH" | "MANUAL";
  limitUsd: string;
  onBreach?: "BLOCK" | "WARN";
  scopeType?: "VIRTUAL_KEY" | "ATTRIBUTED_USER";
  cycleAnchorAt?: Date;
}): Promise<void> {
  await prisma.gatewayBudget.create({
    data: {
      id: input.id,
      name: input.id,
      organizationId: ORG_ID,
      scopeType: input.scopeType ?? "VIRTUAL_KEY",
      scopeId: input.virtualKeyId,
      window: input.window,
      limitUsd: input.limitUsd,
      onBreach: input.onBreach ?? "BLOCK",
      createdById: USER_ID,
      cycleAnchorAt: input.cycleAnchorAt ?? null,
      resetsAt: new Date(Date.now() + 86_400_000),
    },
  });
}

/**
 * What each of these budgets reports as spent, in the order asked for, as of
 * `now`. The clock is an argument because an anchored budget's period moves
 * with it, and the whole point of one is which side of its own boundary a
 * debit falls on.
 */
async function spentUsdFor({
  budgetIds,
  now,
}: {
  budgetIds: string[];
  now?: Date;
}): Promise<string[]> {
  const budgets = await prisma.gatewayBudget.findMany({ where: { id: { in: budgetIds } } });
  const spends = await chRepo.getSpendForBudgetsAcrossTenants(
    [PROJECT_ID],
    budgetIds.map((id) => budgets.find((b) => b.id === id)!),
    now,
  );
  return budgetIds.map((id) => spends.find((s) => s.budgetId === id)?.spentUsd ?? "missing");
}

/** The same figure as the list view renders it, through the service. */
async function listedSpentUsdFor(budgetIds: string[]): Promise<string[]> {
  const listed = await service.list(ORG_ID);
  return budgetIds.map((id) => listed.find((b) => b.id === id)?.spentUsd.toString() ?? "missing");
}

describe.skipIf(!databaseUrl || !chUrl)("sibling budgets on one virtual key", () => {
  beforeAll(async () => {
    chRepo = new GatewayBudgetClickHouseRepository(async () => createTestClickHouseClient(chUrl!));
    service = PrismaGatewayAdapter.create({
      database: prisma,
      projects,
      evaluators: {} as never,
      monitors: {} as never,
      changes: {} as never,
      audit: {} as never,
      budgetSpend: chRepo,
    }).build();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
    });
    await prisma.team.create({
      data: { id: TEAM_ID, name: `Team ${suffix}`, slug: TEAM_ID, organizationId: ORG_ID },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: PROJECT_ID,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${PROJECT_ID}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@acme.test`, name: "ACME Admin" },
    });

    for (const vk of [PAIR_VK, TRIO_VK, WINDOWS_VK, MANUAL_VK, SEATS_VK, ANCHOR_VK]) {
      await createVirtualKey(vk);
    }

    // A hard cap and a soft cap on one key: the standard provisioning pair.
    await createBudget({
      id: `bdg-pair-hard-${suffix}`,
      virtualKeyId: PAIR_VK,
      window: "DAY",
      limitUsd: TIGHT_LIMIT_USD,
      onBreach: "BLOCK",
    });
    await createBudget({
      id: `bdg-pair-soft-${suffix}`,
      virtualKeyId: PAIR_VK,
      window: "DAY",
      limitUsd: LOOSE_LIMIT_USD,
      onBreach: "WARN",
    });

    for (const n of ["a", "b", "c"]) {
      await createBudget({
        id: `bdg-trio-${n}-${suffix}`,
        virtualKeyId: TRIO_VK,
        window: "DAY",
        limitUsd: LOOSE_LIMIT_USD,
      });
    }

    await createBudget({
      id: `bdg-win-day-${suffix}`,
      virtualKeyId: WINDOWS_VK,
      window: "DAY",
      limitUsd: LOOSE_LIMIT_USD,
    });
    await createBudget({
      id: `bdg-win-month-${suffix}`,
      virtualKeyId: WINDOWS_VK,
      window: "MONTH",
      limitUsd: LOOSE_LIMIT_USD,
    });

    // MANUAL windows never read the rollup: they carry a period floor, which
    // sends them down the raw-ledger read instead. That read had the same
    // defect and needs its own cover.
    await createBudget({
      id: `bdg-man-hard-${suffix}`,
      virtualKeyId: MANUAL_VK,
      window: "MANUAL",
      limitUsd: LOOSE_LIMIT_USD,
    });
    await createBudget({
      id: `bdg-man-soft-${suffix}`,
      virtualKeyId: MANUAL_VK,
      window: "MANUAL",
      limitUsd: LOOSE_LIMIT_USD,
      onBreach: "WARN",
    });

    // An anchored month and a calendar month on one key. Their periods overlap
    // but do not coincide, which is what makes each one's own boundary
    // observable.
    await createBudget({
      id: `bdg-anch-month-${suffix}`,
      virtualKeyId: ANCHOR_VK,
      window: "MONTH",
      limitUsd: LOOSE_LIMIT_USD,
      cycleAnchorAt: CYCLE_ANCHOR,
    });
    await createBudget({
      id: `bdg-anch-cal-${suffix}`,
      virtualKeyId: ANCHOR_VK,
      window: "MONTH",
      limitUsd: LOOSE_LIMIT_USD,
    });

    await createBudget({
      id: `bdg-seat-a-${suffix}`,
      virtualKeyId: SEATS_VK,
      window: "DAY",
      limitUsd: LOOSE_LIMIT_USD,
      scopeType: "ATTRIBUTED_USER",
    });
    await createBudget({
      id: `bdg-seat-b-${suffix}`,
      virtualKeyId: SEATS_VK,
      window: "DAY",
      limitUsd: LOOSE_LIMIT_USD,
      scopeType: "ATTRIBUTED_USER",
    });
  }, 180_000);

  afterAll(async () => {
    const ch = createTestClickHouseClient(chUrl!);
    for (const table of ["gateway_budget_ledger_events", "gateway_budget_scope_totals"]) {
      await ch.command({
        query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: PROJECT_ID },
      });
    }
    await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  }, 120_000);

  describe("given a hard cap and a soft cap on the same virtual key", () => {
    const hardId = `bdg-pair-hard-${suffix}`;
    const softId = `bdg-pair-soft-${suffix}`;

    /** @scenario "Two budgets on one key each report the request's own cost" */
    it("reports each budget's spend as one request, not two", async () => {
      await writeDebits({ virtualKeyId: PAIR_VK });

      expect(await spentUsdFor({ budgetIds: [hardId, softId] })).toEqual(["0.001", "0.001"]);
    });

    /** @scenario "The budget list shows a shared key's budgets undoubled" */
    it("renders the same undoubled figure in the list view", async () => {
      expect(await listedSpentUsdFor([hardId, softId])).toEqual(["0.001", "0.001"]);
    });

    /** @scenario "A hard cap sharing a key does not block at half its limit" */
    it("still admits a request whose true spend is under the cap", async () => {
      // $0.001 spent against a $0.0015 cap. Counting the soft cap's ledger row
      // as well would read $0.002 and refuse the request here.
      const decision = await service.check({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        virtualKeyId: PAIR_VK,
        principalUserId: USER_ID,
        projectedCostUsd: "0.0001",
      });

      expect(decision.decision).toBe("allow");
      expect(decision.blockedBy).toHaveLength(0);
      // The decision payload is the gateway's own reconciliation contract and
      // keeps its fixed six decimals; only the published figures changed unit.
      expect(decision.scopes.find((s) => s.scopeId === PAIR_VK)?.spentUsd).toBe("0.001000");
    });
  });

  describe("given three budgets on the same virtual key", () => {
    const ids = ["a", "b", "c"].map((n) => `bdg-trio-${n}-${suffix}`);

    /** @scenario "A third budget on a shared key does not inflate the others" */
    it("reports one request's cost against each of the three", async () => {
      await writeDebits({ virtualKeyId: TRIO_VK });

      expect(await spentUsdFor({ budgetIds: ids })).toEqual(["0.001", "0.001", "0.001"]);
    });
  });

  describe("given sibling budgets on the same key with different windows", () => {
    const dayId = `bdg-win-day-${suffix}`;
    const monthId = `bdg-win-month-${suffix}`;

    /** @scenario "Sibling budgets on different windows total independently" */
    it("totals each window's own period, both undoubled", async () => {
      await writeDebits({ virtualKeyId: WINDOWS_VK });
      await writeDebits({ virtualKeyId: WINDOWS_VK });

      // Both windows contain both requests today, and each must see exactly
      // the two, not the four rows the pair of budgets wrote between them.
      expect(await spentUsdFor({ budgetIds: [dayId, monthId] })).toEqual(["0.002", "0.002"]);
    });
  });

  describe("given two manual-window budgets on the same virtual key", () => {
    const hardId = `bdg-man-hard-${suffix}`;
    const softId = `bdg-man-soft-${suffix}`;

    /** @scenario "Manual-window budgets sharing a key each report once" */
    it("reports one request's cost against each, off the raw ledger", async () => {
      await writeDebits({ virtualKeyId: MANUAL_VK });

      expect(await spentUsdFor({ budgetIds: [hardId, softId] })).toEqual(["0.001", "0.001"]);
    });
  });

  describe("given an anchored month and a calendar month on the same key", () => {
    const anchoredId = `bdg-anch-month-${suffix}`;
    const calendarId = `bdg-anch-cal-${suffix}`;

    /** @scenario "An anchored budget counts spend across a calendar boundary until its own period rolls" */
    /** @scenario "Anchored and calendar siblings on one key total their own periods" */
    it("counts a debit from the previous calendar month, until the anchored period rolls", async () => {
      // 20 June: inside the anchored period that opened on 17 June, and in
      // neither July calendar month.
      await writeDebits({ virtualKeyId: ANCHOR_VK, occurredAt: BACKDATED_DEBIT_AT });
      // 15 July: inside both the anchored period and the July calendar one.
      await writeDebits({ virtualKeyId: ANCHOR_VK, occurredAt: FRESH_DEBIT_AT });

      // On 15 July the anchored budget still holds both debits, because its
      // period runs 17 June to 17 July. The calendar sibling sees only the
      // July one. This is the case the whole feature exists for: a customer
      // billed from the 17th gets a figure that spans the calendar boundary.
      expect(
        await spentUsdFor({
          budgetIds: [anchoredId, calendarId],
          now: INSIDE_ANCHORED_PERIOD,
        }),
      ).toEqual(["0.002", "0.001"]);

      // On 20 July the anchored period has rolled: its floor moved to 17 July,
      // so both debits are behind it and the new period reads zero. The
      // calendar sibling is untouched, still inside July.
      expect(
        await spentUsdFor({
          budgetIds: [anchoredId, calendarId],
          now: AFTER_ANCHORED_ROLLOVER,
        }),
      ).toEqual(["0", "0.001"]);
    });
  });

  describe("given two per-seat templates anchored on the same virtual key", () => {
    const seatAId = `bdg-seat-a-${suffix}`;
    const seatBId = `bdg-seat-b-${suffix}`;
    const END_USER = "seat-holder@acme.test";

    /** @scenario "Two per-seat templates on one key each see the seat's own spend" */
    it("reports the seat's true spend under each template", async () => {
      await writeDebits({ virtualKeyId: SEATS_VK, endUserId: END_USER });

      const breakdowns = await Promise.all(
        [seatAId, seatBId].map(async (id) => {
          const budget = (await prisma.gatewayBudget.findUniqueOrThrow({
            where: { id },
          })) as Parameters<typeof chRepo.getBucketSpendBreakdownForBudget>[0]["budget"];
          return await chRepo.getBucketSpendBreakdownForBudget({
            budget,
            tenantIds: [PROJECT_ID],
            boundaries: [],
          });
        }),
      );

      for (const buckets of breakdowns) {
        expect(buckets).toEqual([
          {
            scopeId: `${SEATS_VK}:${END_USER}`,
            spentNanoUsd: 1_000_000,
            spentUsd: "0.001",
          },
        ]);
      }
    });
  });
});
