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
 * Cost amortization: `go run ./cmd/service` recompiles on every call,
 * which on CI's cold module cache exceeds any reasonable health-poll
 * budget. Instead we `go build` the binary ONCE per test process into
 * a cached path under the repo's .vitest-tmp/ and exec it directly —
 * the compiled binary boots in ~1s.
 *
 * Skipped when ANY of:
 *   - `go` is not on PATH
 *   - testcontainers Redis + ClickHouse are not running
 */
import {
  execFileSync,
  execSync,
  spawn,
  type ChildProcess,
} from "node:child_process";
import fs from "node:fs";
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
const shouldRun = hasTestcontainers && hasGo();

// Cached compiled binary. Lives under the repo's .vitest-tmp/ so a
// single CI shard or local re-run reuses the build artifact across
// vitest restarts. `os.tmpdir()` would work too, but keeping it inside
// the repo means `make clean` / artifact cleanup picks it up.
const NLPGO_TEST_BIN_DIR = path.join(REPO_ROOT, "langwatch", ".vitest-tmp");
const NLPGO_TEST_BIN = path.join(
  NLPGO_TEST_BIN_DIR,
  process.platform === "win32" ? "nlpgo-test.exe" : "nlpgo-test",
);

/**
 * Builds the nlpgo binary once and caches it on disk. Subsequent calls
 * skip the build if the cached binary is newer than the most-recently
 * modified .go source file under services/nlpgo (cheap staleness check
 * matching what `go build` itself would conclude).
 *
 * Returns the absolute path to the binary.
 */
function ensureNlpgoBinary(timeoutMs = 600_000): string {
  fs.mkdirSync(NLPGO_TEST_BIN_DIR, { recursive: true });

  // Cheap staleness check: rebuild if any .go file under services/nlpgo
  // or cmd/service is newer than the cached binary's mtime.
  let cachedMtime = 0;
  try {
    cachedMtime = fs.statSync(NLPGO_TEST_BIN).mtimeMs;
  } catch {
    cachedMtime = 0;
  }
  const watchDirs = [
    path.join(REPO_ROOT, "services", "nlpgo"),
    path.join(REPO_ROOT, "cmd", "service"),
    path.join(REPO_ROOT, "pkg"),
  ].filter((p) => fs.existsSync(p));

  function newestGoMtime(dir: string): number {
    let newest = 0;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          stack.push(full);
        } else if (e.name.endsWith(".go") || e.name === "go.mod" || e.name === "go.sum") {
          try {
            const m = fs.statSync(full).mtimeMs;
            if (m > newest) newest = m;
          } catch {
            /* ignore */
          }
        }
      }
    }
    return newest;
  }

  const newestSrcMtime = watchDirs.reduce(
    (acc, d) => Math.max(acc, newestGoMtime(d)),
    0,
  );

  if (cachedMtime > 0 && newestSrcMtime <= cachedMtime) {
    return NLPGO_TEST_BIN;
  }

  // Cold/stale: actually compile. `go build` honours module cache, so
  // back-to-back runs in the same CI job are fast even after the first.
  // execFileSync (not execSync) — pass argv as an array so the shell
  // never interprets the binary path. REPO_ROOT can sit under a worktree
  // dir like `.claude/worktrees/...` whose absolute path could in
  // principle contain spaces or shell metachars; binding through argv
  // sidesteps that entirely (CodeQL js/shell-command-injection-from-environment).
  execFileSync(
    "go",
    ["build", "-o", NLPGO_TEST_BIN, "./cmd/service"],
    {
      cwd: REPO_ROOT,
      stdio: process.env.NLPGO_TEST_LOG === "1" ? "inherit" : "pipe",
      timeout: timeoutMs,
    },
  );
  return NLPGO_TEST_BIN;
}

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

    // Diagnostic capture for when the CH assertion fails — without this,
    // "expected 0 to be greater than 0" gives no signal about which stage
    // of the pipeline (nlpgo emit / wire shape / fold/projection / CH
    // write) actually broke. We always capture; we only DUMP on failure.
    interface OtlpDelivery {
      receivedAt: number;
      url: string;
      traceIds: string[];
      spanCount: number;
      spanNames: string[];
      // Captured AFTER handleOtlpTraceRequest returns — when this is
      // non-zero the wire arrived fine but the collection service
      // dropped/deduped/failed spans before they reached the event
      // store. errorMessage carries the per-span reason if any.
      rejectedSpans?: number;
      collectionErrorMessage?: string;
      collectionThrew?: string;
    }
    const otlpDeliveries: OtlpDelivery[] = [];
    // Cap the stderr ring buffer so a chatty subprocess can't OOM the
    // vitest worker — 256 KiB is more than enough to hold the trailing
    // panic / error context that actually matters.
    const NLPGO_STDERR_CAP = 256 * 1024;
    let nlpgoStderrBuf = "";

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
      // Reset per-suite diagnostic state. The capture arrays are module-
      // scoped to keep the fake server's request handler simple — flush
      // them here so a re-running suite doesn't show stale wire data.
      otlpDeliveries.length = 0;
      nlpgoStderrBuf = "";

      // Flush Redis once so reactor-job orphans from prior runs don't
      // log "Unknown job in global queue" noise (matches the
      // loopPrevention.reactor.integration.test.ts pattern). Wrap in
      // a one-retry helper so a transient ETIMEDOUT on a saturated CI
      // runner doesn't kill the whole suite before the test even runs.
      const redis = getTestRedisConnection();
      if (redis) {
        try {
          await redis.flushall();
        } catch {
          await sleep(2_000);
          await redis.flushall();
        }
      }

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
        req.on("error", (err) => {
          if (process.env.NLPGO_TEST_LOG === "1") {
            // eslint-disable-next-line no-console
            console.error("[fake-langwatch] request stream error", err);
          }
          try {
            res.statusCode = 500;
            res.end();
          } catch {
            /* response may already be closed */
          }
        });
        req.on("end", () => {
          void (async () => {
            const body = Buffer.concat(chunks);
            const url = req.url ?? "";
            try {
              if (url.includes("/api/otel/v1/traces")) {
                const decoded = ExportTraceServiceRequest.decode(
                  new Uint8Array(body),
                );
                // Capture before dispatching into the pipeline so that
                // a downstream throw doesn't blank the diagnostic.
                const traceIds = new Set<string>();
                const spanNames: string[] = [];
                let spanCount = 0;
                for (const rs of decoded.resourceSpans ?? []) {
                  for (const ss of rs.scopeSpans ?? []) {
                    for (const s of ss.spans ?? []) {
                      spanCount++;
                      traceIds.add(
                        Buffer.from(s.traceId).toString("hex"),
                      );
                      spanNames.push(s.name);
                    }
                  }
                }
                const delivery: OtlpDelivery = {
                  receivedAt: Date.now(),
                  url,
                  traceIds: [...traceIds],
                  spanCount,
                  spanNames,
                };
                otlpDeliveries.push(delivery);
                try {
                  const collectionResult =
                    await traceCollection.handleOtlpTraceRequest(
                      tenantIdString,
                      decoded,
                      "DISABLED",
                    );
                  delivery.rejectedSpans = collectionResult.rejectedSpans;
                  delivery.collectionErrorMessage =
                    collectionResult.errorMessage;
                } catch (err) {
                  delivery.collectionThrew =
                    err instanceof Error
                      ? `${err.message}\n${err.stack ?? ""}`
                      : String(err);
                  throw err;
                }
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

      // Build nlpgo (cached). The build itself can take a couple of
      // minutes on a cold CI module cache; subsequent runs in the same
      // job are near-instant because of the staleness check.
      const binary = ensureNlpgoBinary();

      // Spawn the pre-built binary. It boots in ~1s.
      //
      // NLPGO_SPAN_SYNC=1 forces nlpgo to use SimpleSpanProcessor
      // instead of BatchSpanProcessor for its per-tenant exporters.
      // Without this, BSP buffers spans for up to 5s before exporting
      // in async batches; on a saturated CI runner that 5s window
      // plus the forceFlushMiddleware's 5s timeout has been observed
      // to stretch the end-to-end "span emitted at nlpgo → row in
      // CH" wall-clock past any reasonable poll budget (three prior
      // widenings: 45s → 120s → 240s, still flaked). Sync export
      // makes the OTLP roundtrip part of the request lifecycle, so
      // by the time fetch() resolves every span for that request has
      // already been delivered to the fake langwatch HTTP server.
      // The only remaining async hop is the event-sourcing pipeline
      // → ClickHouse fold/projection.
      nlpgoProcess = spawn(binary, ["nlpgo"], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NLPGO_CHILD_BYPASS: "true",
          NLPGO_SPAN_SYNC: "1",
          SERVER_ADDR: `:${NLPGO_PORT}`,
          LANGWATCH_ENDPOINT: langwatchUrl,
          NLPGO_ENGINE_LANGWATCH_BASE_URL: langwatchUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      const drain = (label: "out" | "err", chunk: Buffer) => {
        const text = chunk.toString();
        // Always keep a rolling tail of stderr so the assertion message
        // can attach the trailing context when CH shows zero spans —
        // otherwise the only signal is "expected 0 to be greater than 0"
        // with no clue whether nlpgo panicked, never bound the port, or
        // emitted under the wrong trace_id.
        if (label === "err") {
          nlpgoStderrBuf += text;
          if (nlpgoStderrBuf.length > NLPGO_STDERR_CAP) {
            nlpgoStderrBuf = nlpgoStderrBuf.slice(-NLPGO_STDERR_CAP);
          }
        }
        if (process.env.NLPGO_TEST_LOG === "1") {
          process.stderr.write(`[nlpgo:${label}] ${text}`);
        }
      };
      // Must drain BOTH pipes — leaving stdout unconsumed will block the
      // Go subprocess on writes once the Linux pipe buffer (~64 KiB) fills.
      nlpgoProcess.stdout?.on("data", (chunk: Buffer) => drain("out", chunk));
      nlpgoProcess.stderr?.on("data", (chunk: Buffer) => drain("err", chunk));
      nlpgoProcess.on("exit", (code, signal) => {
        if (code !== 0 && code !== null) {
          // eslint-disable-next-line no-console
          console.error(
            `nlpgo exited unexpectedly: code=${code} signal=${signal}`,
          );
        }
      });

      // Health check on the pre-built binary. The binary itself boots
      // in ~1s, but on a saturated CI runner the spawn + healthz path
      // has been observed to stretch past 30s (the lifecycle includes
      // child-bypass setup + per-tenant exporter init). 30s was too
      // tight and `retry: 1` on the it() doesn't cover beforeAll, so
      // a single slow boot kills the suite outright. Bump to 120s.
      await waitForNlpgoHealth(120_000);
    }, 700_000); // build (up to 600s cold) + boot + health window

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
        },
      };
    }

    // 300s per attempt + retry: 1 → two attempts max. Boy-scouts pass
    // on the CI flake: transient Redis/ClickHouse connect ETIMEDOUTs
    // (saturated runner) get a second chance before the suite is
    // declared red. A real regression — nlpgo emitting the wrong
    // trace_id — fails both attempts and surfaces normally.
    it(
      "every span persisted in ClickHouse shares the inbound trace_id, and at least one links back to the inbound span_id",
      { timeout: 300_000, retry: 1 },
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

        // Poll ClickHouse for the persisted spans. Three flush windows
        // chain here: nlpgo's BatchSpanProcessor (5s scheduled delay) +
        // OTLP HTTP roundtrip + the event-sourcing fold/map projections.
        // The integration shard runs this alongside other heavyweight
        // subprocess + pipeline tests under a 4-wide vitest pool; on a
        // saturated CI runner the chain has been observed to need well
        // past 45s purely from scheduler contention (the spans DO land,
        // just late). First widening (45s→120s, 90s→180s outer) absorbed
        // most contention but still flaked at ~194s total. 240s deadline
        // + 300s outer it() budget below absorb the long tail too. The
        // budget widenings cannot mask a real regression because the
        // assertions still require the spans to actually arrive under
        // the inbound trace_id — they just give the documented async
        // chain more wall-clock on a fully saturated CI runner.
        //
        // CRITICAL: we must NOT exit the loop on the first non-empty
        // result. The studio root span ends AFTER its children, so BSP
        // exports it in a LATER batch — children show up first, root
        // second. If we asserted on the first non-empty snapshot, we'd
        // see only execute_component(parent=studio_root) rows and miss
        // the studio_root(parent=inbound) row that the assertion actually
        // depends on. Exit only when the load-bearing row arrives.
        const ch = getTestClickHouseClient()!;

        interface SpanRow {
          TraceId: string;
          SpanId: string;
          ParentSpanId: string | null;
          SpanName: string;
        }

        async function fetchRows(): Promise<SpanRow[]> {
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
          return await result.json<SpanRow>();
        }

        const hasLinkedSpan = (rows: SpanRow[]): boolean =>
          rows.some(
            (r) => (r.ParentSpanId ?? "").toLowerCase() === PARENT_SPAN_ID,
          );

        // Count event_log rows for the inbound trace_id. recordSpan's
        // aggregateId IS the trace_id, so this tells us whether the
        // command actually persisted events to the event store. Split
        // from fetchRows on purpose: event_log empty + stored_spans
        // empty means the command never dispatched (collection-service
        // bug, queue-not-routing, etc.); event_log non-empty + stored_
        // spans empty means the map projection isn't consuming
        // (groupQueue worker not draining, projection error, etc.).
        async function countEventLogRows(): Promise<number> {
          const result = await ch.query({
            query: `
              SELECT count() AS n
              FROM event_log
              WHERE TenantId = {tenantId:String}
                AND AggregateType = 'trace'
                AND AggregateId = {traceId:String}
            `,
            query_params: {
              tenantId: tenantIdString,
              traceId: PARENT_TRACE_ID,
            },
            format: "JSONEachRow",
          });
          const rs = await result.json<{ n: number | string }>();
          return Number(rs[0]?.n ?? 0);
        }

        let rows: SpanRow[] = [];
        let eventLogCount = 0;
        const deadline = Date.now() + 240_000;
        while (Date.now() < deadline) {
          rows = await fetchRows();
          if (rows.length > 0 && hasLinkedSpan(rows)) break;
          await sleep(500);
        }
        // Capture event_log count AFTER the polling loop so the
        // diagnostic shows the most-up-to-date pipeline state — if
        // events landed late but projection still didn't fire, we see
        // it.
        try {
          eventLogCount = await countEventLogRows();
        } catch {
          eventLogCount = -1;
        }

        // Build a diagnostic summary that splits the pipeline into its
        // observable stages, so the assertion message tells us WHICH
        // stage broke instead of a bare "expected 0 to be greater than 0".
        const buildDiagnostic = (): string => {
          const traceIdsSeen = new Set<string>();
          let totalSpans = 0;
          for (const d of otlpDeliveries) {
            for (const t of d.traceIds) traceIdsSeen.add(t);
            totalSpans += d.spanCount;
          }
          const otlpForInbound = otlpDeliveries.filter((d) =>
            d.traceIds.includes(PARENT_TRACE_ID),
          );
          const otherTraceIds = [...traceIdsSeen].filter(
            (t) => t !== PARENT_TRACE_ID,
          );
          const totalRejected = otlpDeliveries.reduce(
            (s, d) => s + (d.rejectedSpans ?? 0),
            0,
          );
          const collectionErrors = otlpDeliveries
            .map((d) => d.collectionErrorMessage)
            .filter((m): m is string => !!m && m.length > 0);
          const collectionThrows = otlpDeliveries
            .map((d) => d.collectionThrew)
            .filter((m): m is string => !!m);
          const stderrTail = nlpgoStderrBuf.slice(-4000);
          return [
            `inbound trace_id: ${PARENT_TRACE_ID}`,
            `OTLP requests received by fake langwatch: ${otlpDeliveries.length}`,
            `  → carrying inbound trace_id: ${otlpForInbound.length}`,
            `  → other trace_ids seen on the wire: ${
              otherTraceIds.length === 0 ? "(none)" : otherTraceIds.join(", ")
            }`,
            `total spans across all OTLP deliveries: ${totalSpans}`,
            `span names on the wire: ${
              otlpDeliveries.flatMap((d) => d.spanNames).join(", ") || "(none)"
            }`,
            // Collection-service stage — between the wire and the event
            // store. Non-zero rejectedSpans means the spans hit the
            // service but were dropped/deduped/failed; collectionErrors
            // carries the per-span reason; collectionThrows means the
            // service crashed mid-call.
            `collection-service rejected spans: ${totalRejected}`,
            `collection-service errors: ${
              collectionErrors.length === 0
                ? "(none)"
                : collectionErrors.join(" | ")
            }`,
            `collection-service threw: ${
              collectionThrows.length === 0
                ? "(none)"
                : collectionThrows.join("\n---\n")
            }`,
            // Event store stage — between the collection service and
            // the map projection. -1 means the diagnostic query itself
            // threw (CH down, schema drift). Non-zero count + zero CH
            // rows narrows the bug to the spanStorage map projection /
            // groupQueue worker. Zero count + collection-service
            // rejected=0 + no throw narrows the bug to the command
            // dispatch path.
            `event_log rows under inbound trace_id: ${eventLogCount}`,
            `CH rows under inbound trace_id: ${rows.length}`,
            `nlpgo stderr tail (last 4000 chars):\n${
              stderrTail || "(empty — nlpgo logged nothing on stderr)"
            }`,
          ].join("\n");
        };

        // CORE ASSERTION 1 — spans landed in CH under the INBOUND trace_id.
        // Pre-fix, this query would return zero rows because nlpgo
        // had emitted them under a fresh trace_id.
        expect(
          rows.length,
          `no spans landed in CH under the inbound trace_id ${PARENT_TRACE_ID} — ` +
            `nlpgo either didn't emit OTLP or emitted them under a different trace_id (the 2026-05-14 bug).\n` +
            `Pipeline diagnostic:\n${buildDiagnostic()}`,
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
            `startStudioSpan failed to extract the W3C parent context.\n` +
            `Spans seen in CH: ${
              rows
                .map(
                  (r) =>
                    `${r.SpanName}(span_id=${r.SpanId}, parent=${
                      r.ParentSpanId ?? "<root>"
                    })`,
                )
                .join(", ") || "(none)"
            }\n` +
            `Pipeline diagnostic:\n${buildDiagnostic()}`,
        ).toBeGreaterThan(0);
      },
    );
  },
);
