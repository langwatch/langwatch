/**
 * The memory twin's account read: the proof's fence, UTC-day groups, sums and the newest values.
 * @see specs/coding-agent/account-burndown.feature
 */
import { AccessNotGrantedError, sealAuthorization } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { sessionEventRecord } from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { MemoryCodingAgentSessionEventRepository } from "../memory.coding-agent-session-event.repository.ts";
import { MemoryCodingAgentDatabase } from "../memory.coding-agent.database.ts";

const ACCOUNT = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const DAY_ONE = Date.parse("2026-11-25T23:30:00.000Z");
const DAY_TWO = Date.parse("2026-11-26T00:30:00.000Z");
const FROM_MS = Date.parse("2026-11-20T00:00:00.000Z");
const TO_MS = Date.parse("2026-11-27T00:00:00.000Z");

function proofOf(grants: Parameters<typeof sealAuthorization>[0]["grants"]) {
  const actor = { type: "user", id: "viewer" } as const;
  return sealAuthorization({
    actor,
    principal: actor,
    scope: { organizationId: "org_acme" },
    grants,
    expiresAt: TO_MS + 60_000,
    purpose: { kind: "route", route: "test" },
  });
}

const ownProof = proofOf([
  { projectId: "project-1", permissions: ["traces:view"], via: [], kind: "own" },
]);

function call(over: Parameters<typeof sessionEventRecord>[0]) {
  return sessionEventRecord({ accountId: ACCOUNT, timeUnixMs: DAY_TWO, ...over });
}

async function repositoryWith(records: ReturnType<typeof call>[]) {
  const repository = MemoryCodingAgentSessionEventRepository.create(
    MemoryCodingAgentDatabase.create(),
  );
  await repository.ensure(records, 30);
  return repository;
}

describe("MemoryCodingAgentSessionEventRepository.summariseAccountUsage", () => {
  describe("given calls on both sides of UTC midnight", () => {
    it("groups them by UTC day and sums each day's tokens and cost", async () => {
      const repository = await repositoryWith([
        call({ recordId: "a", timeUnixMs: DAY_ONE, inputTokens: 10, costUsd: 0.5 }),
        call({ recordId: "b", timeUnixMs: DAY_TWO, inputTokens: 20, costUsd: 1 }),
        call({ recordId: "c", timeUnixMs: DAY_TWO + 1000, inputTokens: 30, costUsd: 2 }),
      ]);

      const rows = await repository.summariseAccountUsage({
        authorization: ownProof,
        fromMs: FROM_MS,
        toMs: TO_MS,
      });

      const byDay = Object.fromEntries(rows.map((row) => [row.day, row]));
      expect(Object.keys(byDay).toSorted()).toEqual(["2026-11-25", "2026-11-26"]);
      expect(byDay["2026-11-25"]?.inputTokens).toBe(10);
      expect(byDay["2026-11-26"]?.inputTokens).toBe(50);
      expect(byDay["2026-11-26"]?.costUsd).toBe(3);
    });
  });

  describe("given the same record written twice", () => {
    it("counts it once", async () => {
      const repository = await repositoryWith([
        call({ recordId: "a", inputTokens: 10 }),
        call({ recordId: "a", inputTokens: 10 }),
      ]);

      const rows = await repository.summariseAccountUsage({
        authorization: ownProof,
        fromMs: FROM_MS,
        toMs: TO_MS,
      });

      expect(rows.map((row) => row.inputTokens)).toEqual([10]);
    });
  });

  describe("given readings and names over time", () => {
    it("keeps the newest name and the newest reading, and counts rate limits", async () => {
      const repository = await repositoryWith([
        call({
          recordId: "a",
          timeUnixMs: DAY_TWO,
          accountName: "Old name",
          accountUsagePercent: 40,
          accountUsageWindow: "seven_day",
        }),
        call({
          recordId: "b",
          timeUnixMs: DAY_TWO + 60_000,
          eventKind: "rate_limit",
          accountName: "ACME Max 1",
          accountUsagePercent: 90,
          accountUsageWindow: "seven_day",
        }),
      ]);

      const [row] = await repository.summariseAccountUsage({
        authorization: ownProof,
        fromMs: FROM_MS,
        toMs: TO_MS,
      });

      expect(row?.name?.value).toBe("ACME Max 1");
      expect(row?.reading?.percent).toBe(90);
      expect(row?.reading?.window).toBe("seven_day");
      expect(row?.rateLimitEvents).toBe(1);
    });
  });

  describe("given rows in projects the proof does not reach", () => {
    it("leaves out other tenants and shared rows outside their window", async () => {
      const repository = await repositoryWith([
        call({ recordId: "a", tenantId: "project-1", inputTokens: 1 }),
        call({ recordId: "b", tenantId: "member", timeUnixMs: DAY_TWO, inputTokens: 10 }),
        call({ recordId: "c", tenantId: "member", timeUnixMs: DAY_ONE, inputTokens: 100 }),
        call({ recordId: "d", tenantId: "stranger", inputTokens: 1000 }),
      ]);
      const aggregate = proofOf([
        { projectId: "project-1", permissions: ["traces:view"], via: [], kind: "own" },
        {
          projectId: "member",
          permissions: ["traces:view"],
          via: ["grant_1"],
          kind: "shared",
          condition: { type: "trace", from: DAY_TWO - 1000, until: null },
        },
      ]);

      const rows = await repository.summariseAccountUsage({
        authorization: aggregate,
        fromMs: FROM_MS,
        toMs: TO_MS,
      });

      expect(rows.reduce((sum, row) => sum + row.inputTokens, 0)).toBe(11);
    });

    it("refuses a proof with no own traces:view grant", async () => {
      const repository = await repositoryWith([call({ recordId: "a" })]);
      const sharedOnly = proofOf([
        {
          projectId: "project-1",
          permissions: ["traces:view"],
          via: ["grant_1"],
          kind: "shared",
          condition: { type: "trace", from: 0, until: null },
        },
      ]);

      await expect(
        repository.summariseAccountUsage({
          authorization: sharedOnly,
          fromMs: FROM_MS,
          toMs: TO_MS,
        }),
      ).rejects.toBeInstanceOf(AccessNotGrantedError);
    });
  });
});
