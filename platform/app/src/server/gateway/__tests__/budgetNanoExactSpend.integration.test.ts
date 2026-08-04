/**
 * @vitest-environment node
 *
 * A budget totals what its requests cost, to the nano-USD.
 *
 * Real Postgres + real ClickHouse, no mocks. Debits are written by the real
 * process manager and read back through the real repository, service and wire
 * DTO, which is the whole path a customer's number travels.
 *
 * A request is priced exactly once, as an integer number of nano-USD, and the
 * spend events publish that integer. The budget ledger used to divide it by
 * 1e9 and store six decimals, so every debit was rounded to the nearest
 * micro-USD BEFORE it was summed. Rounding each debit and then adding is not
 * the same number as adding and then rounding, and the difference compounds
 * with request count instead of cancelling: on live data a budget read 219000
 * nano against a true 212250, and one serving small requests read 100000
 * against a true 55050. The REST surface published that figure as the
 * canonical integer the spend events carry, so the two did not reconcile.
 *
 * Every amount here is deliberately NOT a whole number of microdollars. That
 * is the only kind of amount that can tell an exact total from a rounded one,
 * and real per-request costs are routinely this shape.
 */
import {
  runWriteGatewayDebits,
  type WriteGatewayDebitsPayload,
} from "@ee/governance/process-manager/gatewayDebits.process";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { GatewayBudgetClickHouseRepository } from "../budget.clickhouse.repository";
import { toBudgetDto } from "../budget.dto";
import { GatewayBudgetService } from "../budget.service";

const suffix = nanoid(8);
const ORG_ID = `org-nano-${suffix}`;
const TEAM_ID = `team-nano-${suffix}`;
const PROJECT_ID = `proj-nano-${suffix}`;
const USER_ID = `usr-nano-${suffix}`;

const SINGLE_VK = `vk_nano_single_${suffix}`;
const SPLIT_VK = `vk_nano_split_${suffix}`;
const MANUAL_VK = `vk_nano_manual_${suffix}`;
const SEAT_VK = `vk_nano_seat_${suffix}`;

/**
 * A cost that is not a whole number of microdollars, and the same total
 * arrived at in three parts.
 *
 * 24650 rounds to 25000 on its own, so three of them rounded first come to
 * 75000 rather than 73950. That 1050-nano gap is the whole bug, and it is the
 * gap that grows with every further request.
 */
const ODD_NANO = 73_950;
const THIRD_NANO = 24_650;
const ROUNDED_FIRST_NANO = 75_000;

const LOOSE_LIMIT_USD = "5";

let service: GatewayBudgetService;
let chRepo: GatewayBudgetClickHouseRepository;
let writeDebits: (payload: WriteGatewayDebitsPayload) => Promise<void>;

/** One served request's debit, as the spend pipeline mints it. */
function servedRequest(options: {
  virtualKeyId: string;
  costNanoUsd: number;
  endUserId?: string;
}): WriteGatewayDebitsPayload {
  return {
    gateway_request_id: `grq_${nanoid()}`,
    project_id: PROJECT_ID,
    organization_id: ORG_ID,
    team_id: TEAM_ID,
    virtual_key_id: options.virtualKeyId,
    principal_user_id: USER_ID,
    end_user_id: options.endUserId ?? "",
    model: "gpt-5-mini",
    model_provider_id: "",
    usage: {
      input_tokens: 300,
      output_tokens: 150,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 0,
    },
    cost_nano_usd: options.costNanoUsd,
    rate_version: "catalog@test",
    status: "confirmed",
    error_type: "",
    duration_ms: 120,
    occurred_at: Date.now(),
  };
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
      scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
    },
  });
}

async function createBudget(input: {
  id: string;
  virtualKeyId: string;
  window: "MONTH" | "MANUAL";
  scopeType?: "VIRTUAL_KEY" | "ATTRIBUTED_USER";
}): Promise<void> {
  await prisma.gatewayBudget.create({
    data: {
      id: input.id,
      name: input.id,
      organizationId: ORG_ID,
      scopeType: input.scopeType ?? "VIRTUAL_KEY",
      scopeId: input.virtualKeyId,
      window: input.window,
      limitUsd: LOOSE_LIMIT_USD,
      onBreach: "BLOCK",
      createdById: USER_ID,
      resetsAt: new Date(Date.now() + 86_400_000),
    },
  });
}

/** What the repository says one budget has spent, in both units. */
async function spendFor(
  budgetId: string,
): Promise<{ spentNanoUsd: number; spentUsd: string }> {
  const budget = await prisma.gatewayBudget.findUniqueOrThrow({
    where: { id: budgetId },
  });
  const [spend] = await chRepo.getSpendForBudgetsAcrossTenants(
    [PROJECT_ID],
    [budget],
  );
  if (!spend) throw new Error(`no spend row for ${budgetId}`);
  return { spentNanoUsd: spend.spentNanoUsd, spentUsd: spend.spentUsd };
}

/** The same budget as the public REST surface publishes it. */
async function wireRowFor(budgetId: string) {
  const listed = await service.list(ORG_ID);
  const row = listed.find((b) => b.id === budgetId);
  if (!row) throw new Error(`budget ${budgetId} missing from the list`);
  return toBudgetDto({ budget: row });
}

/** The nano sum the ledger itself holds, read straight out of ClickHouse. */
async function ledgerNanoFor(budgetId: string): Promise<number> {
  const client = await getClickHouseClientForProject(PROJECT_ID);
  if (!client) throw new Error("no ClickHouse client in test environment");
  const result = await client.query({
    query: `
      SELECT toString(sum(AmountNanoUSD)) AS nano
      FROM gateway_budget_ledger_events FINAL
      WHERE TenantId = {tenantId:String}
        AND BudgetId = {budgetId:String}
        AND Status = 'success'
    `,
    query_params: { tenantId: PROJECT_ID, budgetId },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ nano: string }>;
  return Number(rows[0]?.nano ?? "0");
}

beforeAll(async () => {
  await startTestContainers();

  await prisma.organization.create({
    data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      name: `Team ${suffix}`,
      slug: TEAM_ID,
      organizationId: ORG_ID,
    },
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

  for (const vk of [SINGLE_VK, SPLIT_VK, MANUAL_VK, SEAT_VK]) {
    await createVirtualKey(vk);
  }

  await createBudget({
    id: `bdg-nano-single-${suffix}`,
    virtualKeyId: SINGLE_VK,
    window: "MONTH",
  });
  await createBudget({
    id: `bdg-nano-split-${suffix}`,
    virtualKeyId: SPLIT_VK,
    window: "MONTH",
  });
  // A MANUAL window carries a period floor, which sends the read down the
  // raw-ledger path instead of the rollup. Both paths had to lose the
  // rounding, so both are covered.
  await createBudget({
    id: `bdg-nano-manual-${suffix}`,
    virtualKeyId: MANUAL_VK,
    window: "MANUAL",
  });
  await createBudget({
    id: `bdg-nano-seat-${suffix}`,
    virtualKeyId: SEAT_VK,
    window: "MONTH",
    scopeType: "ATTRIBUTED_USER",
  });

  chRepo = new GatewayBudgetClickHouseRepository(async (tenantId) => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) throw new Error("no ClickHouse client in test environment");
    return client;
  });
  service = GatewayBudgetService.create(prisma, chRepo);
  writeDebits = runWriteGatewayDebits({ prisma, budgetCHRepository: chRepo });
}, 180_000);

afterAll(async () => {
  await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
  await prisma.team.deleteMany({ where: { id: TEAM_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await stopTestContainers();
}, 120_000);

describe("given a request priced below one microdollar", () => {
  const budgetId = `bdg-nano-single-${suffix}`;

  /** @scenario "A budget totals a cost that is not a whole number of microdollars" */
  it("totals the exact nano-USD the request was priced at", async () => {
    await writeDebits(
      servedRequest({ virtualKeyId: SINGLE_VK, costNanoUsd: ODD_NANO }),
    );

    const spend = await spendFor(budgetId);
    expect(spend.spentNanoUsd).toBe(ODD_NANO);
    expect(spend.spentUsd).toBe("0.00007395");
  });

  /** @scenario "A budget and its spend events report the same integer" */
  it("publishes that integer on the wire, with the string derived from it", async () => {
    const row = await wireRowFor(budgetId);

    expect(row.spent_nano_usd).toBe(ODD_NANO);
    expect(row.spent_usd).toBe("0.00007395");
    // The pair is one number in two units, so the ledger settles both.
    expect(row.spent_nano_usd).toBe(await ledgerNanoFor(budgetId));
  });
});

describe("when the same total arrives as several requests", () => {
  const budgetId = `bdg-nano-split-${suffix}`;

  /** @scenario "Per-request rounding does not accumulate across requests" */
  it("adds the debits rather than adding what each rounds to", async () => {
    for (let i = 0; i < 3; i++) {
      await writeDebits(
        servedRequest({ virtualKeyId: SPLIT_VK, costNanoUsd: THIRD_NANO }),
      );
    }

    const spend = await spendFor(budgetId);
    expect(spend.spentNanoUsd).toBe(ODD_NANO);
    expect(spend.spentNanoUsd).not.toBe(ROUNDED_FIRST_NANO);
    expect(spend.spentUsd).toBe("0.00007395");
  });
});

describe("when the budget reads from its own boundary rather than the rollup", () => {
  const budgetId = `bdg-nano-manual-${suffix}`;

  /** @scenario "A budget reading from its own boundary stays exact" */
  it("keeps the raw-ledger total exact too", async () => {
    for (let i = 0; i < 3; i++) {
      await writeDebits(
        servedRequest({ virtualKeyId: MANUAL_VK, costNanoUsd: THIRD_NANO }),
      );
    }

    const spend = await spendFor(budgetId);
    expect(spend.spentNanoUsd).toBe(ODD_NANO);
    expect(spend.spentUsd).toBe("0.00007395");
  });
});

describe("given a per-person template whose seats have spend", () => {
  const budgetId = `bdg-nano-seat-${suffix}`;

  it("reports the seats it is watching and no total of its own", async () => {
    await writeDebits(
      servedRequest({
        virtualKeyId: SEAT_VK,
        costNanoUsd: ODD_NANO,
        endUserId: "person-a",
      }),
    );

    const row = await wireRowFor(budgetId);
    // One allowance per person is not a total, and a number here reads as
    // one. The seats are the honest answer.
    expect(row.spent_usd).toBeNull();
    expect(row.spent_nano_usd).toBeNull();
    expect(row.end_users_seen).toBe(1);
  });
});
