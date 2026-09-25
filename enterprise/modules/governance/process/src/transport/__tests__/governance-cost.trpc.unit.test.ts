// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `governanceCost.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/governanceCost.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { governanceCostTrpcTransport } from "../governance-cost.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const FIGURE = { amountUsd: 12.5, cellsWithoutAmount: 0, currenciesWithoutUsdAmount: [] };

function mount(options: { permits?: (permission: string) => boolean } = {}) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    governanceCostDailyByProvider: async (input) => {
      calls.push(input);
      const rows = [{ day: "2026-09-01", provider: "openai", ...FIGURE }];
      return { unavailableReason: null, rows, windowDays: input.windowDays };
    },
    governanceCostSpendByModel: async (input) => {
      calls.push(input);
      return { unavailableReason: null, rows: [{ model: "gpt-5", ...FIGURE }], windowDays: 7 };
    },
    governanceCostPeriodRecords: async (input) => {
      calls.push(input);
      return { unavailableReason: "no_governance_project", records: [] };
    },
    governanceCostSpenders: async (input) => {
      calls.push(input);
      const row = { provider: "openai", rawActorId: "u-1", label: "Ada", agentId: "", ...FIGURE };
      return { unavailableReason: null, rows: [row], windowDays: input.windowDays };
    },
  });
  const permits = options.permits ?? (() => true);
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits, asked })).mount(
    governanceCostTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the governanceCost tRPC namespace", () => {
  it("serves main's breakdown queries", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      dailyByProvider: "query",
      spendByModel: "query",
      periodRecords: "query",
      spenders: "query",
    });
  });

  it("defaults the window to 30 days and asks governanceCost:view", async () => {
    const { caller, asked, calls } = mount();

    const answer = await caller.dailyByProvider({ organizationId: "org_1" });

    expect(answer.windowDays).toBe(30);
    expect(answer.rows[0]).toEqual({ day: "2026-09-01", provider: "openai", ...FIGURE });
    expect(asked).toEqual(["governanceCost:view"]);
    expect(calls).toEqual([{ organizationId: "org_1", windowDays: 30 }]);
  });

  it("keeps the currency list on a model row, as main's spread did", async () => {
    const { caller } = mount();

    await expect(caller.spendByModel({ organizationId: "org_1", windowDays: 7 })).resolves.toEqual({
      unavailableReason: null,
      rows: [{ model: "gpt-5", ...FIGURE }],
      windowDays: 7,
    });
  });

  it("refuses a window beyond a year before reaching the application", async () => {
    const { caller, calls } = mount();

    await expect(
      caller.spendByModel({ organizationId: "org_1", windowDays: 366 }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a day the calendar does not have", async () => {
    const { caller, calls } = mount();
    const period = { organizationId: "org_1", toDay: "2026-03-01", provider: "openai" };

    await expect(caller.periodRecords({ ...period, fromDay: "2026-02-31" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a period that ends before it starts", async () => {
    const { caller, calls } = mount();
    const period = { organizationId: "org_1", provider: "openai" };

    await expect(
      caller.periodRecords({ ...period, fromDay: "2026-03-02", toDay: "2026-03-01" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls).toEqual([]);
  });

  it("answers a period with the unavailable reason the application gives", async () => {
    const { caller } = mount();
    const period = { organizationId: "org_1", provider: "openai" };

    await expect(
      caller.periodRecords({ ...period, fromDay: "2024-02-29", toDay: "2024-03-31" }),
    ).resolves.toEqual({ unavailableReason: "no_governance_project", records: [] });
  });

  it("asks for both the cost and the identity permission before naming spenders", async () => {
    const { caller, asked } = mount();

    const answer = await caller.spenders({ organizationId: "org_1" });

    expect(answer.rows[0]?.label).toBe("Ada");
    expect([...asked].toSorted()).toEqual(["governance:view", "governanceCost:view"]);
  });

  it("refuses spenders to a caller holding only the cost permission", async () => {
    const { caller, calls } = mount({
      permits: (permission) => permission === "governanceCost:view",
    });

    await expect(caller.spenders({ organizationId: "org_1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(calls).toEqual([]);
  });
});
