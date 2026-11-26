/**
 * The subscription-account week through its real SQL against a migrated ClickHouse (00136): the
 * newest reading wins, a newer row without a limit clears an older limit, a redelivered row
 * counts once, one project never sees another's accounts, and an aggregate spans its members.
 * @see specs/coding-agent/account-burndown.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { sealAuthorization } from "@langwatch/authorization";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sessionEventRecord } from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { CodingAgentAccountBurndownService } from "../../../services/coding-agent-account-burndown.service.ts";
import { CODING_AGENT_ID_INDEXES } from "../clickhouse.coding-agent-id-indexes.database.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "../clickhouse.coding-agent-session-event.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();
const tag = randomUUID();
const projectId = `${tag}-project`;
const otherProjectId = `${tag}-other`;
const ACCOUNT = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const HOUR = 60 * 60 * 1000;
const nowMs = Date.parse("2026-11-26T12:00:00.000Z");

let ch: ClickHouseClient;
let repository: CodingAgentSessionEventsClickHouseRepository;

function call(over: Parameters<typeof sessionEventRecord>[0]) {
  return sessionEventRecord({
    tenantId: projectId,
    sessionId: `${tag}-session`,
    accountId: ACCOUNT,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 1000,
    cacheCreationTokens: 50,
    costUsd: 0.25,
    ...over,
  });
}

beforeAll(async () => {
  if (!clickHouseUrl) return;
  ch = createTestClickHouseClient(clickHouseUrl);
  repository = CodingAgentSessionEventsClickHouseRepository.create({
    clickhouse: vendorQueryClient({ vendor: ch, indexes: CODING_AGENT_ID_INDEXES }),
    defaultTraceRetentionDays: 30,
  });
  const yesterday = call({
    recordId: "a".repeat(64),
    timeUnixMs: nowMs - 26 * HOUR,
    accountName: "Old name",
    accountUsagePercent: 40,
    accountUsageWindow: "seven_day",
    accountUsageReadAtMs: nowMs - 26 * HOUR,
    accountLimitedUntilMs: nowMs + 5 * HOUR,
  });
  await repository.ensure([
    yesterday,
    call({
      recordId: "b".repeat(64),
      timeUnixMs: nowMs - HOUR,
      accountName: "ACME Max 1",
      accountSource: "pool",
      accountUsagePercent: 72,
      accountUsageWindow: "seven_day",
      accountUsageResetsAtMs: nowMs + 48 * HOUR,
      accountUsageReadAtMs: nowMs - HOUR,
    }),
    call({
      recordId: "c".repeat(64),
      sessionId: `${tag}-codex`,
      agent: "codex",
      model: "gpt-6.1",
      timeUnixMs: nowMs - 2 * HOUR,
    }),
    call({
      recordId: "d".repeat(64),
      eventKind: "rate_limit",
      model: "",
      inputTokens: 0,
      timeUnixMs: nowMs - 30 * 60 * 1000,
    }),
    call({ recordId: "e".repeat(64), accountId: "", timeUnixMs: nowMs - HOUR }),
  ]);
  // Redelivered: the same row again must not count twice.
  await repository.ensure([yesterday]);
  await repository.ensure([
    call({
      tenantId: otherProjectId,
      recordId: "f".repeat(64),
      accountId: "other-account",
      timeUnixMs: nowMs - HOUR,
    }),
  ]);
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query:
      "ALTER TABLE coding_agent_session_events DELETE WHERE TenantId IN ({tenantIds:Array(String)})",
    query_params: { tenantIds: [projectId, otherProjectId] },
  });
  await ch.close();
});

/** The proof the traces:view door mints; an aggregate's shares its members under trace windows. */
function proofFor(tenants: readonly string[]) {
  const actor = { type: "user", id: `${tag}-viewer` } as const;
  const [own, ...shared] = tenants.length === 1 ? tenants : [`${tag}-aggregate`, ...tenants];
  return sealAuthorization({
    actor,
    principal: actor,
    scope: { organizationId: `${tag}-organization` },
    grants: [
      { projectId: own!, permissions: ["traces:view"], via: [], kind: "own" as const },
      ...shared.map((projectId) => ({
        projectId,
        permissions: ["traces:view" as const],
        via: [`${tag}-grant`],
        kind: "shared" as const,
        condition: { type: "trace" as const, from: 0, until: null },
      })),
    ],
    expiresAt: Date.now() + 5 * 60 * 1000,
    purpose: { kind: "route", route: "test" },
  });
}

function readWeek(tenant: string | readonly string[], canSeeCosts = true) {
  return CodingAgentAccountBurndownService.create({
    sessionEvents: repository,
    clock: { nowMs: () => nowMs },
  }).readWeek({ authorization: proofFor([tenant].flat()), canSeeCosts });
}

describe.skipIf(clickHouseUrl === null)("subscription account week on ClickHouse", () => {
  /** @scenario the reading is the newest one the account reported */
  it("shows the newest reading, whose missing limit clears the older one", async () => {
    const page = await readWeek(projectId);
    const account = page.accounts[0];

    expect(account?.name).toBe("ACME Max 1");
    expect(account?.source).toBe("pool");
    expect(account?.reading).toEqual({
      percent: 72,
      window: "seven_day",
      resetsAtMs: nowMs + 48 * HOUR,
      readAtMs: nowMs - HOUR,
      limitedUntilMs: null,
    });
  });

  /** @scenario the week shows tokens and cost per day */
  it("sums each UTC day once per row, redeliveries included", async () => {
    const account = (await readWeek(projectId)).accounts[0];

    expect(account?.days.map((day) => day.day).at(-1)).toBe("2026-11-26");
    expect(account?.days.find((day) => day.day === "2026-11-25")?.inputTokens).toBe(100);
    expect(account?.days.find((day) => day.day === "2026-11-26")?.inputTokens).toBe(200);
    expect(account?.totals.totalTokens).toBe(3 * 1160);
    expect(account?.totals.costUsd).toBeCloseTo(0.75);
    expect(account?.rateLimitEvents).toBe(1);
  });

  /** @scenario each account says which agents ran on it */
  it("names both agents and the models they ran", async () => {
    const account = (await readWeek(projectId)).accounts[0];

    expect(account?.agents).toEqual(["claude_code", "codex"]);
    expect(account?.topModels).toEqual(["claude-3", "gpt-6.1"]);
  });

  /** @scenario a viewer only sees accounts of the project they may read */
  it("returns one project's accounts only", async () => {
    const page = await readWeek(projectId);
    const other = await readWeek(otherProjectId);

    expect(page.accounts.map((account) => account.accountId)).toEqual([ACCOUNT]);
    expect(other.accounts.map((account) => account.accountId)).toEqual(["other-account"]);
  });

  /** @scenario an aggregate project shows the accounts of its member projects */
  it("spans every project the proof fences, as the sessions list does", async () => {
    const page = await readWeek([projectId, otherProjectId]);

    expect(page.accounts.map((account) => account.accountId).toSorted()).toEqual(
      [ACCOUNT, "other-account"].toSorted(),
    );
  });

  /** @scenario sessions sent with a project key show their accounts */
  it("needs no user on the rows, only the project", async () => {
    const page = await readWeek(projectId, false);

    expect(page.accounts).toHaveLength(1);
    expect(page.accounts[0]?.totals.costUsd).toBeNull();
  });
});
