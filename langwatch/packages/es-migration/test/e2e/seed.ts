/**
 * E2E seed script — populates Elasticsearch with a small, deterministic set
 * of traces and scenario events that the es-migration tool will read.
 *
 * Shapes mirror `src/server/tracer/types.ts` (ElasticSearchTrace) and
 * `packages/es-migration/src/migrations/simulations/definition.ts`
 * (EsScenarioEvent). Keeping the seed close to the real production shape is
 * what makes this test meaningful.
 *
 * Usage:
 *   ELASTICSEARCH_NODE_URL=http://localhost:9200 \
 *   E2E_TENANT_ID=e2e-test-project \
 *   pnpm tsx test/e2e/seed.ts
 */

import { Client as ElasticClient } from "@elastic/elasticsearch";

const ES_URL = process.env.ELASTICSEARCH_NODE_URL ?? "http://localhost:9200";
const TENANT_ID = process.env.E2E_TENANT_ID ?? "e2e-test-project";
const TRACE_COUNT = parseInt(process.env.E2E_TRACE_COUNT ?? "5", 10);
const SIM_COUNT = parseInt(process.env.E2E_SIMULATION_COUNT ?? "3", 10);

const TRACE_INDEX_ALIAS = "search-traces-alias";
const SCENARIO_EVENTS_INDEX_ALIAS = "scenario-events-alias";

async function main(): Promise<void> {
  const es = new ElasticClient({ node: ES_URL });

  // Use a fixed base timestamp so runs are deterministic.
  const baseMs = Date.parse("2025-01-01T00:00:00Z");

  // --- Traces ---
  const traceDocs = [];
  for (let i = 0; i < TRACE_COUNT; i++) {
    const traceId = `e2e-trace-${i.toString().padStart(3, "0")}`;
    const spanId = `e2e-span-${i.toString().padStart(3, "0")}`;
    const startedAt = baseMs + i * 60_000;
    traceDocs.push({
      trace_id: traceId,
      project_id: TENANT_ID,
      metadata: {
        custom: { environment: "e2e" },
        all_keys: ["environment"],
      },
      timestamps: {
        started_at: startedAt,
        inserted_at: startedAt,
        updated_at: startedAt,
      },
      input: { value: `hello ${i}` },
      output: { value: `world ${i}` },
      spans: [
        {
          span_id: spanId,
          trace_id: traceId,
          type: "llm",
          name: "e2e-llm-span",
          project_id: TENANT_ID,
          timestamps: {
            started_at: startedAt,
            finished_at: startedAt + 1_000,
            inserted_at: startedAt,
            updated_at: startedAt,
          },
        },
      ],
    });
  }

  // Bulk-index traces
  const traceBulkBody = traceDocs.flatMap((doc) => [
    { index: { _index: TRACE_INDEX_ALIAS, _id: doc.trace_id } },
    doc,
  ]);
  if (traceBulkBody.length > 0) {
    const res = await es.bulk({
      refresh: "wait_for",
      body: traceBulkBody,
    });
    if (res.errors) {
      const errs = res.items
        .map((it) => it.index?.error ?? null)
        .filter(Boolean);
      throw new Error(
        `Trace bulk-index had errors: ${JSON.stringify(errs.slice(0, 3))}`,
      );
    }
  }
  console.error(`Seeded ${TRACE_COUNT} traces into ${TRACE_INDEX_ALIAS}`);

  // --- Scenario events ---
  // Each simulation run gets 3 events: RUN_STARTED, MESSAGE_SNAPSHOT, RUN_FINISHED
  const scenarioDocs: Array<{
    _id: string;
    doc: Record<string, unknown>;
  }> = [];
  for (let i = 0; i < SIM_COUNT; i++) {
    const scenarioRunId = `e2e-sim-run-${i.toString().padStart(3, "0")}`;
    const scenarioId = `e2e-scenario-${i.toString().padStart(3, "0")}`;
    const batchRunId = `e2e-batch-${i.toString().padStart(3, "0")}`;
    const baseTs = baseMs + i * 120_000;

    scenarioDocs.push({
      _id: `${scenarioRunId}-started`,
      doc: {
        project_id: TENANT_ID,
        type: "RUN_STARTED",
        timestamp: baseTs,
        scenario_id: scenarioId,
        scenario_run_id: scenarioRunId,
        batch_run_id: batchRunId,
        metadata: { name: `E2E Scenario ${i}`, description: "e2e test" },
      },
    });
    scenarioDocs.push({
      _id: `${scenarioRunId}-message`,
      doc: {
        project_id: TENANT_ID,
        type: "MESSAGE_SNAPSHOT",
        timestamp: baseTs + 1_000,
        scenario_id: scenarioId,
        scenario_run_id: scenarioRunId,
        batch_run_id: batchRunId,
        messages: [
          { id: "m1", role: "user", content: `question ${i}` },
          { id: "m2", role: "assistant", content: `answer ${i}` },
        ],
      },
    });
    scenarioDocs.push({
      _id: `${scenarioRunId}-finished`,
      doc: {
        project_id: TENANT_ID,
        type: "RUN_FINISHED",
        timestamp: baseTs + 2_000,
        scenario_id: scenarioId,
        scenario_run_id: scenarioRunId,
        batch_run_id: batchRunId,
        status: "completed",
        results: {
          verdict: "success",
          reasoning: "e2e test",
          metCriteria: ["c1"],
          unmetCriteria: [],
        },
      },
    });
  }

  const scenarioBulkBody = scenarioDocs.flatMap(({ _id, doc }) => [
    { index: { _index: SCENARIO_EVENTS_INDEX_ALIAS, _id } },
    doc,
  ]);
  if (scenarioBulkBody.length > 0) {
    const res = await es.bulk({
      refresh: "wait_for",
      body: scenarioBulkBody,
    });
    if (res.errors) {
      const errs = res.items
        .map((it) => it.index?.error ?? null)
        .filter(Boolean);
      throw new Error(
        `Scenario bulk-index had errors: ${JSON.stringify(errs.slice(0, 3))}`,
      );
    }
  }
  console.error(
    `Seeded ${SIM_COUNT} simulation runs (${scenarioDocs.length} events) into ${SCENARIO_EVENTS_INDEX_ALIAS}`,
  );

  await es.close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
