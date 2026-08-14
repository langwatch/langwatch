/**
 * @vitest-environment node
 *
 * A character-priced call moves the budget it was admitted under.
 *
 * Real Postgres + real ClickHouse. The path a synthesis request's money
 * travels: the quantities the gateway measured, rated by the same service
 * the ingest seam prices with, debited by the real process manager, read
 * back through the real repository.
 *
 * The regression: the wire dropped the character count, so the request rated
 * at zero and the ledger recorded nothing. Three tts-1 calls worth $0.18
 * moved a production budget $0.0002 (langwatch/langwatch#6934).
 *
 * Spec: specs/ai-gateway/audio-endpoints.feature
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
import {
  EMPTY_SPEND_USAGE,
  type SpendUsage,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { rateSpendNanoUsd } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { GatewayBudgetClickHouseRepository } from "../budget.clickhouse.repository";

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

let chRepo: GatewayBudgetClickHouseRepository;
let writeDebits: (payload: WriteGatewayDebitsPayload) => Promise<void>;

/** One served request, priced the way the ingest seam prices it. */
function servedRequest(model: string, usage: SpendUsage) {
  const rated = rateSpendNanoUsd({ model, usage });
  const payload: WriteGatewayDebitsPayload = {
    gateway_request_id: `grq_${nanoid()}`,
    project_id: PROJECT_ID,
    organization_id: ORG_ID,
    team_id: TEAM_ID,
    virtual_key_id: VK_ID,
    principal_user_id: USER_ID,
    end_user_id: "",
    model,
    model_provider_id: "",
    usage,
    cost_nano_usd: rated.costNanoUsd,
    rate_version: rated.rateVersion,
    status: "confirmed",
    error_type: "",
    duration_ms: 620,
    occurred_at: Date.now(),
  };
  return payload;
}

async function spentNanoUsd(): Promise<number> {
  const budget = await prisma.gatewayBudget.findUniqueOrThrow({
    where: { id: BUDGET_ID },
  });
  const [spend] = await chRepo.getSpendForBudgetsAcrossTenants(
    [PROJECT_ID],
    [budget],
  );
  if (!spend) throw new Error("no spend row for the budget");
  return spend.spentNanoUsd;
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
  await prisma.virtualKey.create({
    data: {
      id: VK_ID,
      organizationId: ORG_ID,
      name: VK_ID,
      hashedSecret: `hash-${VK_ID}`,
      displayPrefix: "vk-lw-xxxxxxx",
      principalUserId: USER_ID,
      createdById: USER_ID,
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

  chRepo = new GatewayBudgetClickHouseRepository(async (tenantId) => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) throw new Error("no ClickHouse client in test environment");
    return client;
  });
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

describe("given a speech request priced by the characters it synthesized", () => {
  /** @scenario A character-priced call debits the budget it was admitted under */
  it("moves the budget by the characters times the per-character rate", async () => {
    const before = await spentNanoUsd();

    await writeDebits(
      servedRequest("openai/tts-1", {
        ...EMPTY_SPEND_USAGE,
        input_chars: SPEECH_CHARS,
      }),
    );

    expect(await spentNanoUsd()).toBe(before + SPEECH_COST_NANO_USD);
  });

  /** @scenario A character-priced call debits the budget it was admitted under */
  it("totals three of them exactly", async () => {
    const before = await spentNanoUsd();

    for (let i = 0; i < 3; i++) {
      await writeDebits(
        servedRequest("openai/tts-1", {
          ...EMPTY_SPEND_USAGE,
          input_chars: SPEECH_CHARS,
        }),
      );
    }

    expect(await spentNanoUsd()).toBe(before + 3 * SPEECH_COST_NANO_USD);
  });

  /** @scenario A character-priced call debits the budget it was admitted under */
  it("moves the budget for a second-priced transcription too", async () => {
    const before = await spentNanoUsd();

    await writeDebits(
      servedRequest("elevenlabs/scribe_v1", {
        ...EMPTY_SPEND_USAGE,
        audio_ms: 60_000,
      }),
    );

    expect(await spentNanoUsd()).toBeGreaterThan(before);
  });
});
