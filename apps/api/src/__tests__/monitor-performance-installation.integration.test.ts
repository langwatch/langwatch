/**
 * @vitest-environment node
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 * The Online Evaluations table publishes the same numbers the analytics page does, both asked
 * of the api booted wholly live over a migrated ClickHouse (§7). The bounded-read scenario lives
 * in the evaluation module.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { AnalyticsApi, analyticsComparisonWindow } from "@langwatch/analytics-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootLiveApi,
  type LiveApi,
  liveDatabaseUrl,
  liveStoresConfigured,
} from "./api-live.fixture.ts";
import {
  buildSeedMatrix,
  deleteSeededTenantRows,
  readAnalyticsPageNumbers,
  seedMonitorPerformance,
  startMigratedClickHouse,
} from "./monitor-performance.fixture.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** The suite's own connection, for the project its ClickHouse rows belong to and cleanup. */
const connection = liveStoresConfigured
  ? PrismaConnectionService.create({
      logger: createLogger("langwatch:test:monitor-performance"),
      guard: new AllowTestQueries(),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: liveDatabaseUrl(), log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const DAY_MS = 24 * 60 * 60 * 1000;
const ns = `test-monitor-performance-${generate("test").toString().toLowerCase()}`;
const scoreEvaluatorId = `${ns}-score`;
const guardrailEvaluatorId = `${ns}-guardrail`;
const endMs = Date.now();
const currentStartMs = endMs - 7 * DAY_MS;
// The window analytics compares against, from the rule its contract publishes.
const previousStartMs = analyticsComparisonWindow({
  start: Temporal.Instant.fromEpochMilliseconds(currentStartMs),
  end: Temporal.Instant.fromEpochMilliseconds(endMs),
}).previousPeriodStart.epochMilliseconds;

let clickHouse: ClickHouseClient;
let api: LiveApi;
/** The project the seeded rows belong to: ClickHouse refuses a tenant no organization holds. */
let tenantId: string;
let organizationId: string;

const monitors = () => [
  { id: scoreEvaluatorId, isGuardrail: false },
  { id: guardrailEvaluatorId, isGuardrail: true },
];

const readTablePerformance = () =>
  api.application.service(EvaluationApi).getMonitorPerformance({
    tenantId,
    monitors: monitors(),
    previousStartMs,
    currentStartMs,
    endMs,
    timeZone: "UTC",
  });

const expectSameNumbers = ({
  table,
  analyticsPage,
}: {
  table: { current: number | null; previous: number | null; points: number[] };
  analyticsPage: { current: number | null; previous: number | null; dailyValues: number[] };
}) => {
  expect(analyticsPage.current).not.toBeNull();
  expect(analyticsPage.previous).not.toBeNull();
  expect(table.current).toBeCloseTo(analyticsPage.current!, 10);
  expect(table.previous).toBeCloseTo(analyticsPage.previous!, 10);
  expect(table.points).toHaveLength(analyticsPage.dailyValues.length);
  table.points.forEach((point, index) => {
    expect(point).toBeCloseTo(analyticsPage.dailyValues[index]!, 10);
  });
};

describe.skipIf(!liveStoresConfigured)("online evaluation monitor performance", () => {
  beforeAll(async () => {
    clickHouse = await startMigratedClickHouse();
    const organization = await prisma.organization.create({
      data: { name: "Monitor Performance", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "Monitor Performance", slug: `--test-team-${ns}`, organizationId },
    });
    const project = await prisma.project.create({
      data: {
        name: "Monitor Performance",
        slug: `--test-project-${ns}`,
        apiKey: `--test-key-${ns}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    tenantId = project.id;
    await seedMonitorPerformance({
      client: clickHouse,
      tenantId,
      seeded: buildSeedMatrix({
        tenantId,
        scoreEvaluatorId,
        guardrailEvaluatorId,
        currentStartMs,
        previousStartMs,
      }),
    });
    api = await bootLiveApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    if (tenantId) await deleteSeededTenantRows({ client: clickHouse, tenantId });
    if (organizationId) {
      await prisma.project.deleteMany({ where: { team: { organizationId } } });
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await connection?.closeOnce();
  });

  describe("when the analytics page reads the same period", () => {
    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same score values as the analytics page", async () => {
      const [scorePerformance] = await readTablePerformance();
      const analyticsPage = await readAnalyticsPageNumbers({
        analytics: api.application.service(AnalyticsApi),
        tenantId,
        evaluatorId: scoreEvaluatorId,
        metric: "evaluations.evaluation_score",
        currentStartMs,
        endMs,
      });

      expectSameNumbers({ table: scorePerformance!, analyticsPage });
    }, 60_000);

    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same pass rate as the analytics page", async () => {
      const [, guardrailPerformance] = await readTablePerformance();
      const analyticsPage = await readAnalyticsPageNumbers({
        analytics: api.application.service(AnalyticsApi),
        tenantId,
        evaluatorId: guardrailEvaluatorId,
        metric: "evaluations.evaluation_pass_rate",
        currentStartMs,
        endMs,
      });

      expectSameNumbers({ table: guardrailPerformance!, analyticsPage });
    }, 60_000);
  });
});
