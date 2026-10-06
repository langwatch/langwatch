/**
 * @vitest-environment node
 * @see specs/automations/process-manager-dispatch.feature
 * The worker booted as main.ts boots it, wholly live over the local Postgres, Redis and a
 * migrated ClickHouse (ARCHITECTURE.md §7: one tier per process). Secrets are synthetic.
 */
import { AutomationApi } from "@langwatch/automation-contract";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { generate } from "@langwatch/ksuid";
import { OrganizationApi } from "@langwatch/organization-contract";
import { processConfig, Server } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { TraceApi } from "@langwatch/trace-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { processModules } from "../process-modules.generated.ts";

const clickHouseUrl = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;
const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;

const FAILING_MONITOR = "monitor-failing";
const PASSING_MONITOR = "monitor-passing";
const REWRITTEN_MONITOR = "monitor-rewritten";
/** Two settlement wake scans: a dropped match dispatches alongside its confirmed siblings. */
const DROP_MARGIN_MS = 10_000;

/** Migrates this suite's endpoint database; `CLICKHOUSE_CLUSTER` would demand a Keeper. */
async function migratedClickHouse(): Promise<string> {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "worker-dispatch-recheck",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned");
  const previousCluster = process.env.CLICKHOUSE_CLUSTER;
  delete process.env.CLICKHOUSE_CLUSTER;
  try {
    await ClickHouseMigrateTask.createFromConfig({
      config: { buildTime: false, skipped: false, sharedUrl: endpoint.url, privateEndpoints: [] },
    }).execute();
  } finally {
    if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
  }
  return endpoint.url;
}

/** Boots and runs the worker; its own Redis database keeps its jobs from other processes. */
async function bootWorker({ clickhouse }: { clickhouse: string }) {
  const server = await Server.create("langwatch-worker")
    .withEnvironment({
      NODE_ENV: "test",
      // No quick tunnel from a test process: it would open a real one where cloudflared is on PATH.
      VOICE_TUNNEL: "false",
      VOICE_WS_PORT: "0",
      WORKER_METRICS_PORT: "0",
      BASE_HOST: "http://langwatch.test",
      API_KEY_PEPPER: "synthetic-api-key-pepper",
      CREDENTIALS_SECRET: "0".repeat(64),
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      REDIS_DB_INDEX: "9",
      CLICKHOUSE_URL: clickhouse,
    })
    .withConfig(processConfig(processModules, "worker"))
    .withProcessOwnership(false)
    .withSecrets((_config, secrets) => secrets.withEnv())
    .start();
  const application = await server.container("worker").boot();
  await server.run(application);
  return { server, application };
}

type Worker = Awaited<ReturnType<typeof bootWorker>>;

describe.skipIf(!clickHouseUrl || !databaseUrl || !redisUrl)(
  "given the worker settles evaluation-filtered automations",
  () => {
    let worker: Worker;
    let projectId: string;
    const traceId = `trace-${generate("test").toString()}`;
    const triggers: Record<string, string> = {};

    /** What the automation spent of its daily ceiling: a slot is taken only once confirmed. */
    const spend = async (name: string): Promise<number> => {
      const status = await worker.application
        .service(AutomationApi)
        .readDailyCapStatus({ projectId });
      return status.counts[triggers[name]!]?.count ?? 0;
    };

    beforeAll(async () => {
      worker = await bootWorker({ clickhouse: await migratedClickHouse() });
      const { organization, team } = await worker.application
        .service(OrganizationApi)
        .createForProvisioning({ name: `Dispatch Recheck ${generate("test").toString()}` });
      const project = await worker.application.service(ProjectApi).create(
        {
          organizationId: organization.id,
          teamId: team.id,
          name: "Dispatch Recheck Project",
          language: "python",
          framework: "openai",
        },
        { id: "user-dispatch-recheck" },
      );
      projectId = project.id;

      await worker.application.service(TraceApi).recordSpan({
        tenantId: projectId,
        occurredAt: Date.now(),
        span: {
          traceId,
          spanId: "span-1",
          name: "test-span",
          kind: 1,
          startTimeUnixNano: `${Date.now() - 2000}000000`,
          endTimeUnixNano: `${Date.now()}000000`,
          attributes: [{ key: "langwatch.input", value: { stringValue: "hello" } }],
          events: [],
          links: [],
          status: {},
          droppedAttributesCount: 0,
          droppedEventsCount: 0,
          droppedLinksCount: 0,
        },
        resource: { attributes: [] },
        instrumentationScope: { name: "test-scope" },
      });
      await vi.waitFor(
        async () => {
          const summary = await worker.application
            .service(TraceApi)
            .findSummary({ projectId, traceId });
          if (summary === null) throw new Error(`trace ${traceId} has not folded yet`);
        },
        { timeout: 60_000, interval: 500 },
      );

      const automations = worker.application.service(AutomationApi);
      const conditions: Record<
        string,
        { filters: Record<string, unknown> } | { filterQuery: string }
      > = {
        matchingVerdict: { filters: { "evaluations.passed": { [FAILING_MONITOR]: ["false"] } } },
        evaluatorOnly: { filters: { "evaluations.evaluator_id": [PASSING_MONITOR] } },
        oppositeVerdict: { filters: { "evaluations.passed": { [PASSING_MONITOR]: ["false"] } } },
        laterVerdict: { filters: { "evaluations.passed": { [REWRITTEN_MONITOR]: ["true"] } } },
        earlierVerdict: { filters: { "evaluations.passed": { [REWRITTEN_MONITOR]: ["false"] } } },
        hasEval: { filterQuery: "has:eval" },
      };
      for (const [name, condition] of Object.entries(conditions)) {
        const trigger = await automations.create({
          projectId,
          name,
          action: "ADD_TO_ANNOTATION_QUEUE",
          actionParams: { annotators: [{ id: "queue-dispatch-recheck", name: "Recheck" }] },
          notificationCadence: "immediate",
          traceDebounceMs: 0,
          ...condition,
        });
        triggers[name] = trigger.id;
      }

      // Each terminal report wakes evaluation's subscriber, which records the matches.
      const evaluations = worker.application.service(EvaluationApi);
      const report = (overrides: {
        evaluationId: string;
        evaluatorId: string;
        passed: boolean;
        occurredAt: number;
      }) =>
        evaluations.reportEvaluation({
          tenantId: projectId,
          evaluatorType: "test/evaluator",
          evaluatorName: "Test Evaluator",
          traceId,
          status: "processed",
          score: overrides.passed ? 1 : 0,
          ...overrides,
        });
      const now = Date.now();
      const rewritten = `eval-${generate("test").toString()}`;
      await report({
        evaluationId: `eval-${generate("test").toString()}`,
        evaluatorId: FAILING_MONITOR,
        passed: false,
        occurredAt: now,
      });
      await report({
        evaluationId: `eval-${generate("test").toString()}`,
        evaluatorId: PASSING_MONITOR,
        passed: true,
        occurredAt: now,
      });
      // One evaluation rewritten in place: failed first, passed on the rerun.
      await report({
        evaluationId: rewritten,
        evaluatorId: REWRITTEN_MONITOR,
        passed: false,
        occurredAt: now,
      });
      await report({
        evaluationId: rewritten,
        evaluatorId: REWRITTEN_MONITOR,
        passed: true,
        occurredAt: now + 1000,
      });

      // Every confirmed automation has dispatched; its dropped siblings settle with them.
      await vi.waitFor(
        async () => {
          for (const name of ["matchingVerdict", "evaluatorOnly", "laterVerdict", "hasEval"]) {
            if ((await spend(name)) !== 1) throw new Error(`${name} has not dispatched yet`);
          }
        },
        { timeout: 120_000, interval: 1000 },
      );
      await new Promise((resolve) => setTimeout(resolve, DROP_MARGIN_MS));
    }, 400_000);

    afterAll(async () => {
      await worker?.server.close();
    });

    describe("when the trace holds the verdict the filter asks for", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("confirms the match, spending one of the automation's daily ceiling", async () => {
        expect(await spend("matchingVerdict")).toBe(1);
      });

      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("confirms a filter that only names the evaluator", async () => {
        expect(await spend("evaluatorOnly")).toBe(1);
      });
    });

    describe("when the trace holds the opposite verdict", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("drops the match", async () => {
        expect(await spend("oppositeVerdict")).toBe(0);
      });
    });

    describe("when an evaluation was rewritten with the opposite verdict", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("confirms a filter asking for the later verdict", async () => {
        expect(await spend("laterVerdict")).toBe(1);
      });

      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("drops a filter asking for the earlier verdict", async () => {
        expect(await spend("earlierVerdict")).toBe(0);
      });
    });

    describe("when the automation's query reads evaluations", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("confirms has:eval on a trace with evaluation runs", async () => {
        expect(await spend("hasEval")).toBe(1);
      });
    });
  },
);
