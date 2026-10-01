// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Ported from main (#8072 steps 2 and 3): every spend read closes its time range at
 * the moment it runs, in the outer query and the dedup subquery alike, and carries
 * a ceiling on threads and runtime. Asserted on the SQL handed to ClickHouse.
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GovernanceClickHouseClient,
  GovernanceClickHouseResult,
  GovernanceClickHouseResolver,
} from "../../../app/governance.members.ts";
import { PrismaActivityMonitorRepository } from "../prisma.ingestion-source-activity.repository.ts";

type ClickHouseCall = Parameters<GovernanceClickHouseClient["query"]>[0];

class RecordedClickHouseClient implements GovernanceClickHouseClient {
  readonly calls: ClickHouseCall[] = [];

  async query(input: ClickHouseCall): Promise<GovernanceClickHouseResult> {
    this.calls.push(input);
    return { json: async () => [] };
  }
}

class SingleClientResolver implements GovernanceClickHouseResolver {
  constructor(private readonly client: GovernanceClickHouseClient) {}

  async getClient(): Promise<GovernanceClickHouseClient> {
    return this.client;
  }
}

const NOW = Date.UTC(2026, 1, 1);

function repository() {
  const clickhouse = new RecordedClickHouseClient();
  const repo = PrismaActivityMonitorRepository.create({
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
    clickhouse: new SingleClientResolver(clickhouse),
  });
  return { repo, clickhouse };
}

/** Each spend read, driven to completion; a read added later without a bound fails here. */
const READS: {
  name: string;
  run: (repo: PrismaActivityMonitorRepository) => Promise<unknown>;
}[] = [
  { name: "summary", run: (repo) => repo.summary({ organizationId: "org-a", windowDays: 7 }) },
  {
    name: "spendByUser",
    run: (repo) => repo.spendByUser({ organizationId: "org-a", windowDays: 7 }),
  },
  {
    name: "spendByDepartment",
    run: (repo) => repo.spendByDepartment({ organizationId: "org-a", windowDays: 7 }),
  },
  {
    name: "spendByTeam",
    run: (repo) => repo.spendByTeam({ organizationId: "org-a", windowDays: 7 }),
  },
  {
    name: "spendOverTime",
    run: (repo) => repo.spendOverTime({ organizationId: "org-a", windowDays: 7, groupBy: "user" }),
  },
];

async function issued(read: (typeof READS)[number]): Promise<ClickHouseCall> {
  const { repo, clickhouse } = repository();
  await read.run(repo);
  const call = clickhouse.calls[0];
  if (!call) throw new Error(`${read.name} issued no ClickHouse query`);
  return call;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityMonitorSpendClickHouseRepository query bounds", () => {
  describe("when a spend read is issued (#8072 step 2: closed upper bound)", () => {
    it.each(READS)("$name binds the upper end of the time range", async (read) => {
      const call = await issued(read);
      expect(call.query_params?.windowEnd).toBe(NOW);
    });

    it.each(READS)("$name pushes the upper bound into the dedup subquery too", async (read) => {
      const call = await issued(read);
      expect(call.query.match(/\{windowEnd:UInt64\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
  });

  describe("when a spend read is issued (#8072 step 3: query execution ceiling)", () => {
    it.each(READS)("$name caps execution time and thread count", async (read) => {
      const call = await issued(read);
      expect(call.clickhouse_settings?.max_execution_time).toBe(45);
      expect(call.clickhouse_settings?.max_threads).toBe(2);
    });
  });
});
