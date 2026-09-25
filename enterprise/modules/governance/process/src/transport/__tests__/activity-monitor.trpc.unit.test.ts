// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `activityMonitor.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/activityMonitor.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { activityMonitorTrpcTransport } from "../activity-monitor.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

function mount(permits: (permission: string) => boolean = () => true) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    activitySpendByUser: async (input, by) => {
      calls.push({ input, by });
      return [];
    },
    activityEventsForSource: async (input, by) => {
      calls.push({ input, by });
      return [];
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits, asked })).mount(
    activityMonitorTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the activityMonitor tRPC namespace", () => {
  it("serves main's nine procedure names, every one a query", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      summary: "query",
      spendByUser: "query",
      spendByTeam: "query",
      spendByDepartment: "query",
      spendOverTime: "query",
      ingestionSourcesHealth: "query",
      recentAnomalies: "query",
      eventsForSource: "query",
      sourceHealthMetrics: "query",
    });
  });

  it("fills main's paging defaults under activityMonitor:view, as the signed-in person", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.spendByUser({ organizationId: "org_1" })).resolves.toEqual([]);
    expect(asked).toEqual(["activityMonitor:view"]);
    expect(calls).toEqual([
      {
        input: {
          organizationId: "org_1",
          windowDays: 30,
          limit: 50,
          offset: 0,
          sortBy: "spend",
          sortDir: "desc",
        },
        by: expect.objectContaining({ id: "user_1" }),
      },
    ]);
  });

  it("refuses a window beyond main's 365 days before the application is reached", async () => {
    const { caller, calls } = mount();

    await expect(
      caller.spendByUser({ organizationId: "org_1", windowDays: 366 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls).toEqual([]);
  });

  it("refuses a caller without activityMonitor:view before the application is reached", async () => {
    const { caller, calls } = mount(() => false);

    await expect(
      caller.eventsForSource({ organizationId: "org_1", sourceId: "src_1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toEqual([]);
  });
});
