/**
 * @vitest-environment node
 *
 * A character-priced call moves the budget it was admitted under.
 *
 * Real Postgres + real ClickHouse. The path a synthesis request's money
 * travels: the quantities the gateway measured, rated by the same service
 * the ingest seam prices with, debited through the same repository the
 * debits writer uses, read back through the same repository the budgets
 * surfaces read.
 *
 * The regression: the wire dropped the character count, so the request rated
 * at zero and the ledger recorded nothing. Three tts-1 calls worth $0.18
 * moved a production budget $0.0002 (langwatch/langwatch#6934).
 *
 * The debits process manager that used to drive this suite lives in the
 * Enterprise governance package, which a core feature package may not depend
 * on, so the rated cost is handed to the repository directly. The rating and
 * the ledger read — the two halves the regression sat between — are the real
 * ones.
 *
 * Spec: specs/ai-gateway/audio-endpoints.feature
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

import { ModelCatalogGatewaySpendRatingAdapter } from "../adapters/model-catalog.gateway-spend-rating.adapter";
import { EMPTY_SPEND_USAGE, type SpendUsage } from "../processes/gateway-spend-commands.process";
import { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support";

const spendRating = ModelCatalogGatewaySpendRatingAdapter.create();
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
const ORG_ID = `org-tts-${suffix}`;
const TEAM_ID = `team-tts-${suffix}`;
const PROJECT_ID = `proj-tts-${suffix}`;
const USER_ID = `usr-tts-${suffix}`;
const VK_ID = `vk_tts_${suffix}`;
const BUDGET_ID = `bdg-tts-${suffix}`;

/** What OpenAI charges for 4000 characters of tts-1, in nano-USD. */
const SPEECH_CHARS = 4000;
const SPEECH_COST_NANO_USD = 60_000_000;

/** What ElevenLabs charges for a minute of scribe_v1, in nano-USD:
 *  60 seconds at $0.0000611 per second. */
const TRANSCRIPTION_MS = 60_000;
const TRANSCRIPTION_COST_NANO_USD = 3_666_000;

let chRepo: GatewayBudgetClickHouseRepository;

/** One served request, priced the way the ingest seam prices it. */
async function serveRequest(model: string, usage: SpendUsage): Promise<void> {
  const rated = spendRating.rateSpendNanoUsd({ model, usage });
  await chRepo.insertDebitsForBudgets([
    {
      tenantId: PROJECT_ID,
      budgetId: BUDGET_ID,
      scope: "VIRTUAL_KEY",
      scopeId: VK_ID,
      window: "MONTH",
      virtualKeyId: VK_ID,
      gatewayRequestId: `grq_${nanoid()}`,
      amountNanoUsd: rated.costNanoUsd,
      tokensInput: usage.input_tokens,
      tokensOutput: usage.output_tokens,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model,
      durationMs: 620,
      status: "SUCCESS",
      occurredAt: new Date(),
    },
  ]);
}

async function spentNanoUsd(): Promise<number> {
  const budget = await prisma.gatewayBudget.findUniqueOrThrow({ where: { id: BUDGET_ID } });
  const [spend] = await chRepo.getSpendForBudgetsAcrossTenants([PROJECT_ID], [budget]);
  if (!spend) throw new Error("no spend row for the budget");
  return spend.spentNanoUsd;
}

describe.skipIf(!databaseUrl || !chUrl)("character- and duration-priced spend", () => {
  beforeAll(async () => {
    chRepo = new GatewayBudgetClickHouseRepository(async () => createTestClickHouseClient(chUrl!));

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
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: VK_ID,
        hashedSecret: `hash-${VK_ID}`,
        displayPrefix: "vk-lw-xxxxxxx",
        principalUserId: USER_ID,
        createdById: USER_ID,
        traceProjectId: PROJECT_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_ID,
        name: BUDGET_ID,
        organizationId: ORG_ID,
        scopeType: "VIRTUAL_KEY",
        scopeId: VK_ID,
        window: "MONTH",
        limitUsd: "50",
        onBreach: "WARN",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 86_400_000),
      },
    });
  }, 180_000);

  afterAll(async () => {
    const client = createTestClickHouseClient(chUrl!);
    for (const table of ["gateway_budget_ledger_events", "gateway_budget_scope_totals"]) {
      await client.command({
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

  describe("given a speech request priced by the characters it synthesized", () => {
    describe("when one call is served", () => {
      /** @scenario A character-priced call debits the budget it was admitted under */
      it("moves the budget by the characters times the per-character rate", async () => {
        const before = await spentNanoUsd();

        await serveRequest("openai/tts-1", { ...EMPTY_SPEND_USAGE, input_chars: SPEECH_CHARS });

        expect(await spentNanoUsd()).toBe(before + SPEECH_COST_NANO_USD);
      });
    });

    describe("when three of them are served", () => {
      /** @scenario A character-priced call debits the budget it was admitted under */
      it("totals them exactly", async () => {
        const before = await spentNanoUsd();

        for (let i = 0; i < 3; i++) {
          await serveRequest("openai/tts-1", { ...EMPTY_SPEND_USAGE, input_chars: SPEECH_CHARS });
        }

        expect(await spentNanoUsd()).toBe(before + 3 * SPEECH_COST_NANO_USD);
      });
    });
  });

  describe("given a transcription request priced by the seconds it transcribed", () => {
    describe("when the duration reaches the spend record", () => {
      /** @scenario A duration-priced transcription debits the budget it was admitted under */
      it("moves the budget by the duration times the per-second rate", async () => {
        const before = await spentNanoUsd();

        await serveRequest("elevenlabs/scribe_v1", {
          ...EMPTY_SPEND_USAGE,
          audio_ms: TRANSCRIPTION_MS,
        });

        expect(await spentNanoUsd()).toBe(before + TRANSCRIPTION_COST_NANO_USD);
      });
    });
  });
});
