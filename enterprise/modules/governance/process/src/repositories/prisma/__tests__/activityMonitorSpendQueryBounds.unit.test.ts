// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Ported from main (#8072 step 2): every spend read closes its time range at the moment it
 * runs. The SQL, its dedup subquery and the step 3 ceiling are trace's, proven by
 * clickhouse.trace-attributed-rollup.repository tests; here, the bound governance asks for.
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createActivityMonitorTestService } from "../../../__tests__/testing.ts";
import type { ActivityMonitorService } from "../../../features/ingestion-source/services/ingestion-source-activity.service.ts";

const NOW = Date.UTC(2026, 1, 1);

function service(endsAsked: number[]) {
  const window = (input: { window: { endMs: number } }) => endsAsked.push(input.window.endMs);
  return createActivityMonitorTestService({
    prisma: prismaDouble({
      project: {
        findFirst: async () => ({ id: "governance-project" }),
        findMany: async () => [{ id: "project-a", departmentId: null }],
      },
      anomalyAlert: { groupBy: async () => [] },
      department: { findMany: async () => [] },
      organizationUser: { findMany: async () => [] },
      ingestionSource: { findMany: async () => [] },
    }),
    clickhouse: {
      getClient: async () => {
        throw new Error("a spend read reads no governance table");
      },
    },
    traces: {
      getAttributedSpendComparison: async ({ endMs }) => {
        endsAsked.push(endMs);
        return { currentSpendUsd: 0, previousSpendUsd: 0, currentActors: 0 };
      },
      findAttributedSpendByValue: async (input) => (window(input), []),
      findSpendByProjectAndValue: async (input) => (window(input), []),
      findAttributedSpendComparisonByValue: async ({ endMs }) => (endsAsked.push(endMs), []),
      findDailyAttributedSpend: async (input) => (window(input), []),
    },
  });
}

/** Each spend read, driven to completion; a read added later without a bound fails here. */
const READS: {
  name: string;
  run: (activity: ActivityMonitorService) => Promise<unknown>;
}[] = [
  { name: "summary", run: (a) => a.summary({ organizationId: "org-a", windowDays: 7 }) },
  { name: "spendByUser", run: (a) => a.spendByUser({ organizationId: "org-a", windowDays: 7 }) },
  {
    name: "spendByDepartment",
    run: (a) => a.spendByDepartment({ organizationId: "org-a", windowDays: 7 }),
  },
  { name: "spendByTeam", run: (a) => a.spendByTeam({ organizationId: "org-a", windowDays: 7 }) },
  {
    name: "spendOverTime",
    run: (a) => a.spendOverTime({ organizationId: "org-a", windowDays: 7, groupBy: "user" }),
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityMonitorService spend read bounds", () => {
  describe("when a spend read is issued (#8072 step 2: closed upper bound)", () => {
    it.each(READS)("$name asks trace for a range ending now", async (read) => {
      const endsAsked: number[] = [];
      await read.run(service(endsAsked));
      expect(endsAsked).toEqual([NOW]);
    });
  });
});
