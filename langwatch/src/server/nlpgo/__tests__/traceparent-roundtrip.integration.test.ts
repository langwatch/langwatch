/**
 * Full-loop end-to-end test for traceparent propagation:
 *
 *   [test]
 *     │ POST /go/studio/execute_sync with traceparent + workflow body
 *     ▼
 *   [real nlpgo subprocess (`go run ./cmd/service nlpgo`)]
 *     │ HTTP/proto OTLP export
 *     ▼
 *   [fake langwatch HTTP server]
 *     │ /api/otel/v1/traces → decode OTLP → call
 *     │  TraceRequestCollectionService.handleOtlpTraceRequest(...)
 *     ▼
 *   [real EventSourcing trace-processing pipeline]
 *     │ RecordSpanCommand → fold + spanStorage projections
 *     ▼
 *   [real ClickHouse (testcontainers)]
 *     │
 *     └── SELECT * FROM stored_spans WHERE TraceId = <parent>
 *
 * Asserts (against the spans persisted in ClickHouse):
 *   1. Spans landed under the INBOUND trace_id (not a fresh one).
 *   2. At least one span has parent_span_id == inbound span_id,
 *      proving Studio's waterfall will render the eval as a child
 *      of the trace it was evaluating.
 *
 * This is the test rchaves asked for after the 2026-05-14 dogfood
 * caught eval spans landing on orphan traces. Previous attempts
 * stopped at "decode the OTLP bytes nlpgo emits" — that proves the
 * wire format but doesn't prove the spans actually survive the
 * roundtrip and land where Studio queries them.
 *
 * Skipped when:
 *   - `go` is not on PATH (CI without Go toolchain)
 *   - testcontainers Redis + ClickHouse are not running
 *   - SKIP_NLPGO_E2E=1 is set
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { TraceRequestCollectionService } from "~/server/app-layer/traces/trace-request-collection.service";
import {
  definePipeline,
  type AggregateType,
} from "~/server/event-sourcing";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "~/server/event-sourcing/__tests__/integration/testHelpers";
import { EventSourcing } from "~/server/event-sourcing/eventSourcing";
import { EventStoreClickHouse } from "~/server/event-sourcing/stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "~/server/event-sourcing/stores/repositories/eventRepositoryClickHouse";
import { RecordSpanCommand } from "~/server/event-sourcing/pipelines/trace-processing/commands/recordSpanCommand";
import { AssignTopicCommand } from "~/server/event-sourcing/pipelines/trace-processing/commands/assignTopicCommand";
import { SpanStorageMapProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.mapProjection";
import { TraceSummaryFoldProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { SpanAppendStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.store";
import { TraceSummaryStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.store";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const otlpRoot = require("@opentelemetry/otlp-transformer/build/src/generated/root");
const ExportTraceServiceRequest = (otlpRoot as any).opentelemetry.proto
  .collector.trace.v1.ExportTraceServiceRequest;

// Unique port for this test alongside the other nlpgo subprocess
// integration tests (55610 / 55611 / 55620 — see CLAUDE.md).
const NLPGO_PORT = 55612;
const PARENT_TRACE_ID = "0123456789abcdef0123456789abcdef";
const PARENT_SPAN_ID = "0011223344556677";

// /langwatch/src/server/nlpgo/__tests__  → up 5 = repo root
const REPO_ROOT = path.resolve(__dirname, "../../../../..");

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);
function hasGo(): boolean {
  try {
    execSync("go version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const shouldRun =
  hasTestcontainers && hasGo() && process.env.SKIP_NLPGO_E2E !== "1";

const noopReactor = { name: "noop", options: {}, handle: async () => {} };

describe.skipIf(!shouldRun)(
  "nlpgo traceparent — full roundtrip through real event-sourcing pipeline into ClickHouse",
  () => {
    let nlpgoProcess: ChildProcess | null = null;
    let langwatchSrv: http.Server | null = null;
    let langwatchUrl = "";

    let eventSourcing: EventSourcing;
    let tracePipeline: {
      commands: { recordSpan: { send: (data: any) => Promise<void> } };
      service: { waitUntilReady: () => Promise<void> };
    };
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;

    function createTracePipeline() {
      const clickHouseClient = getTestClickHouseClient();
      const redisConnection = getTestRedisConnection();
      if (!clickHouseClient || !redisConnection) {
        throw new Error("ClickHouse + Redis required.");
      }

      const eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => clickHouseClient),
      );
      eventSourcing = EventSourcing.createWithStores({
        eventStore,
        clickhouse: async () => clickHouseClient,
        redis: redisConnection,
        processRole: "worker",
      });

      const spanAppendStore = new SpanAppendStore(
        new SpanStorageService(
          new SpanStorageClickHouseRepository(async () => clickHouseClient),
        ).repository,
      );
      const traceSummaryStore = new TraceSummaryStore(
        new TraceSummaryService(
          new TraceSummaryClickHouseRepository(async () => clickHouseClient),
        ).repository,
      );

      const pipelineName = `trace_nlpgo_e2e_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const pipelineDef = definePipeline<TraceProcessingEvent>()
        .withName(pipelineName)
        .withAggregateType("trace" as AggregateType)
        .withFoldProjection(
          "traceSummary",
          new TraceSummaryFoldProjection({ store: traceSummaryStore }) as any,
        )
        .withMapProjection(
          "spanStorage",
          new SpanStorageMapProjection({ store: spanAppendStore }) as any,
        )
        .withReactor("traceSummary", "evaluationTrigger", noopReactor as any)
        .withReactor("traceSummary", "customEvaluationSync", noopReactor as any)
        .withReactor("traceSummary", "traceUpdateBroadcast", noopReactor as any)
        .withReactor(
          "traceSummary",
          "simulationMetricsSync",
          noopReactor as any,
        )
        .withReactor("traceSummary", "projectMetadata", noopReactor as any)
        .withReactor("spanStorage", "spanStorageBroadcast", noopReactor as any)
        // REAL RecordSpanCommand with no-op PII/cost/token deps —
        // same pattern as the other event-sourcing integration tests.
        .withCommand(
          "recordSpan",
          class extends RecordSpanCommand {
            static override readonly schema = RecordSpanCommand.schema;
            constructor() {
              super({
                piiRedactionService: { redactSpan: async () => {} } as any,
                costEnrichmentService: { enrichSpan: async () => {} } as any,
                tokenEstimationService: {
                  estimateSpanTokens: async () => {},
                } as any,
              });
            }
          } as any,
        )
        .withCommand("assignTopic", AssignTopicCommand as any)
        .build();

      const registered = eventSourcing.register(pipelineDef);
      return {
        commands: registered.commands as any,
        service: registered.service as any,
      };
    }

    async function waitForNlpgoHealth(timeoutMs = 90_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`http://127.0.0.1:${NLPGO_PORT}/healthz`);
          if (r.status === 200 || r.status === 503) return;
        } catch {
          // not listening yet
        }
        await sleep(500);
      }
      throw new Error(
        `nlpgo did not become healthy within ${timeoutMs}ms — ` +
          `re-run with NLPGO_TEST_LOG=1 to stream stderr.`,
      );
    }

    beforeAll(async () => {
      // Flush Redis once so reactor-job orphans from prior runs don't
      // log "Unknown job in global queue" noise (matches the
      // loopPrevention.reactor.integration.test.ts pattern).
      const redis = getTestRedisConnection();
      if (redis) await redis.flushall();

      tracePipeline = createTracePipeline();
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      await tracePipeline.service.waitUntilReady();

      // Trace request collection service wired to the SAME recordSpan
      // command dispatcher the pipeline uses — so nlpgo's OTLP feeds
      // straight into the event-sourcing flow that lands in CH.
      const traceCollection = new TraceRequestCollectionService({
        dedup: {
          tryAcquireProcessingLock: async () => true,
          tryConfirmProcessed: async () => undefined,
          tryReleaseOnFailure: async () => undefined,
        } as any,
        recordSpan: (data) => tracePipeline.commands.recordSpan.send(data),
      });

      // Fake langwatch HTTP server.
      //   /api/otel/v1/traces: decode → dispatch into pipeline.
      //   /api/evaluations/...: canned eval result so the evaluator
      //     block has somewhere to call.
      langwatchSrv = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          void (async () => {
            const body = Buffer.concat(chunks);
            const url = req.url ?? "";
            try {
              if (url.includes("/api/otel/v1/traces")) {
                const decoded = ExportTraceServiceRequest.decode(
                  new Uint8Array(body),
                );
                await traceCollection.handleOtlpTraceRequest(
                  tenantIdString,
                  decoded,
                  "DISABLED",
                );
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ partialSuccess: {} }));
                return;
              }
              if (
                url.includes("/api/evaluations/") &&
                url.endsWith("/evaluate")
              ) {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    status: "processed",
                    score: 1,
                    passed: true,
                    details: "ok",
                  }),
                );
                return;
              }
              res.statusCode = 404;
              res.end();
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error("[fake-langwatch] handler failed", err);
              res.statusCode = 500;
              res.end();
            }
          })();
        });
      });
      await new Promise<void>((resolve) =>
        langwatchSrv!.listen(0, "127.0.0.1", () => resolve()),
      );
      langwatchUrl = `http://127.0.0.1:${(langwatchSrv.address() as AddressInfo).port}`;

      // Spawn nlpgo.
      nlpgoProcess = spawn("go", ["run", "./cmd/service", "nlpgo"], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NLPGO_CHILD_BYPASS: "true",
          SERVER_ADDR: `:${NLPGO_PORT}`,
          LANGWATCH_ENDPOINT: langwatchUrl,
          NLPGO_ENGINE_LANGWATCH_BASE_URL: langwatchUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      nlpgoProcess.stderr?.on("data", (chunk: Buffer) => {
        if (process.env.NLPGO_TEST_LOG === "1") {
          process.stderr.write(`[nlpgo] ${chunk.toString()}`);
        }
      });
      nlpgoProcess.on("exit", (code, signal) => {
        if (code !== 0 && code !== null) {
          // eslint-disable-next-line no-console
          console.error(
            `nlpgo exited unexpectedly: code=${code} signal=${signal}`,
          );
        }
      });

      await waitForNlpgoHealth();
    }, 150_000);

    afterAll(async () => {
      if (nlpgoProcess?.pid) {
        const pgid = -nlpgoProcess.pid;
        try {
          process.kill(pgid, "SIGTERM");
        } catch {
          /* group already gone */
        }
        const exited = await Promise.race([
          new Promise<boolean>((resolve) =>
            nlpgoProcess!.once("exit", () => resolve(true)),
          ),
          sleep(3000).then(() => false),
        ]);
        if (!exited) {
          try {
            process.kill(pgid, "SIGKILL");
          } catch {
            /* best-effort */
          }
        }
      }
      if (langwatchSrv) {
        await new Promise<void>((resolve) =>
          langwatchSrv!.close(() => resolve()),
        );
      }
      if (eventSourcing) {
        await eventSourcing.close();
        await sleep(1000);
      }
      await cleanupTestDataForTenant(tenantIdString);
    });

    function makeWorkflowBody(traceId: string) {
      return {
        type: "execute_flow",
        payload: {
          trace_id: traceId,
          origin: "evaluation",
          workflow: {
            workflow_id: "wf",
            // Non-empty api_key is load-bearing: nlpgo's TenantRouter
            // drops spans whose context has no api_key.
            api_key: "test-key-traceparent-e2e",
            spec_version: "1.3",
            name: "x",
            icon: "x",
            description: "x",
            version: "x",
            template_adapter: "default",
            nodes: [
              {
                id: "entry",
                type: "entry",
                data: {
                  train_size: 1.0,
                  test_size: 0.0,
                  seed: 1,
                  outputs: [
                    { identifier: "input", type: "str" },
                    { identifier: "output", type: "str" },
                  ],
                  dataset: {
                    inline: {
                      records: { input: ["hello"], output: ["hello"] },
                      count: 1,
                    },
                  },
                },
              },
              {
                id: "eval",
                type: "evaluator",
                data: {
                  parameters: [
                    {
                      identifier: "evaluator",
                      type: "str",
                      value: "langevals/exact_match",
                    },
                  ],
                },
              },
              { id: "end", type: "end", data: {} },
            ],
            edges: [
              {
                id: "e1",
                source: "entry",
                sourceHandle: "input",
                target: "eval",
                targetHandle: "input",
                type: "default",
              },
              {
                id: "e2",
                source: "entry",
                sourceHandle: "output",
                target: "eval",
                targetHandle: "output",
                type: "default",
              },
              {
                id: "e3",
                source: "eval",
                sourceHandle: "any",
                target: "end",
                targetHandle: "any",
                type: "default",
              },
            ],
            state: {},
          },
          inputs: [{ input: "hello", output: "hello" }],
          manual_execution_mode: false,
          // do_not_trace=false is the load-bearing bit: with true,
          // nlpgo's startStudioSpan returns a no-op and the engine's
          // children create a fresh trace_id (the 2026-05-14 bug).
          do_not_trace: false,
          run_evaluations: false,
          origin: "evaluation",
        },
      };
    }

    it(
      "every span persisted in ClickHouse shares the inbound trace_id, and at least one links back to the inbound span_id",
      async () => {
        const traceparent = `00-${PARENT_TRACE_ID}-${PARENT_SPAN_ID}-01`;
        const body = makeWorkflowBody(PARENT_TRACE_ID);

        const resp = await fetch(
          `http://127.0.0.1:${NLPGO_PORT}/go/studio/execute_sync`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              traceparent,
              "X-LangWatch-Origin": "evaluation",
              "X-LangWatch-Causality-Depth": "0",
            },
            body: JSON.stringify(body),
          },
        );
        const respText = await resp.text();
        expect(resp.ok, `nlpgo response ${resp.status}: ${respText}`).toBe(
          true,
        );

        // Poll ClickHouse for the persisted spans. Two flush windows
        // chain here: nlpgo's BatchSpanProcessor (5s default) + the
        // event-sourcing fold/map projection workers (sub-second).
        // 25s deadline absorbs both with margin.
        const ch = getTestClickHouseClient()!;

        interface SpanRow {
          TraceId: string;
          SpanId: string;
          ParentSpanId: string | null;
          SpanName: string;
        }

        let rows: SpanRow[] = [];
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline && rows.length === 0) {
          const result = await ch.query({
            query: `
              SELECT TraceId, SpanId, ParentSpanId, SpanName
              FROM stored_spans
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                AND (TenantId, TraceId, SpanId, UpdatedAt) IN (
                  SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
                  FROM stored_spans
                  WHERE TenantId = {tenantId:String}
                    AND TraceId = {traceId:String}
                  GROUP BY TenantId, TraceId, SpanId
                )
            `,
            query_params: {
              tenantId: tenantIdString,
              traceId: PARENT_TRACE_ID,
            },
            format: "JSONEachRow",
          });
          rows = await result.json<SpanRow>();
          if (rows.length === 0) await sleep(500);
        }

        // CORE ASSERTION 1 — spans landed in CH under the INBOUND trace_id.
        // Pre-fix, this query would return zero rows because nlpgo
        // had emitted them under a fresh trace_id.
        expect(
          rows.length,
          `no spans landed in CH under the inbound trace_id ${PARENT_TRACE_ID} — ` +
            `nlpgo either didn't emit OTLP or emitted them under a different trace_id (the 2026-05-14 bug)`,
        ).toBeGreaterThan(0);

        // CORE ASSERTION 2 — every row matches the inbound trace_id.
        // (Defense in depth — the query filter already enforces this,
        // but pin it as a behavioral contract anyway.)
        for (const row of rows) {
          expect(row.TraceId.toLowerCase()).toBe(PARENT_TRACE_ID);
        }

        // CORE ASSERTION 3 — at least one span has parent_span_id
        // matching the inbound span_id. This is the load-bearing
        // claim: in Studio's waterfall the eval workflow's root span
        // renders as a child of the parent trace's root span.
        const linkedToParent = rows.filter(
          (r) => (r.ParentSpanId ?? "").toLowerCase() === PARENT_SPAN_ID,
        );
        expect(
          linkedToParent.length,
          `no span has ParentSpanId == inbound ${PARENT_SPAN_ID} — ` +
            `startStudioSpan failed to extract the W3C parent context. ` +
            `Spans seen: ${rows
              .map((r) => `${r.SpanName}(parent=${r.ParentSpanId ?? "<root>"})`)
              .join(", ")}`,
        ).toBeGreaterThan(0);
      },
      90_000,
    );
  },
);
