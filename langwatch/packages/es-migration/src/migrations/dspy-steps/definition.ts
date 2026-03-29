import { nanoid } from "nanoid";
import type { DspyStepClickHouseRepository } from "~/server/app-layer/dspy-steps/repositories/dspy-step.clickhouse.repository.js";
import type { DspyStepData, DspyLlmCallData } from "~/server/app-layer/dspy-steps/types.js";
import type { EventRecord } from "~/server/event-sourcing/stores/repositories/eventRepository.types.js";
import type { DSPyStep } from "~/server/experiments/types.js";
import type { EsHit, MigrationDefinition, DirectWriteResult } from "../../lib/types.js";

type EsDspyStepDoc = DSPyStep & EsHit;

interface DspyStepMigrationDeps {
  dspyStepRepository: DspyStepClickHouseRepository;
}

function computeLlmSummary(llmCalls: DspyLlmCallData[]): {
  total: number;
  totalTokens: number;
  totalCost: number;
} {
  let totalTokens = 0;
  let totalCost = 0;
  for (const call of llmCalls) {
    totalTokens += (call.prompt_tokens ?? 0) + (call.completion_tokens ?? 0);
    totalCost += call.cost ?? 0;
  }
  return { total: llmCalls.length, totalTokens, totalCost };
}

function toEpochMs(ts: number | string): number {
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (Number.isNaN(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

export function createDspyStepMigrationDefinition(
  deps: DspyStepMigrationDeps,
): MigrationDefinition<EsDspyStepDoc> {
  return {
    name: "dspy-steps",
    esIndex: "search-dspy-steps-alias",
    esSort: [{ "timestamps.created_at": "asc" }, { run_id: "asc" }],
    aggregateType: "dspy_step",
    timestampField: "timestamps.created_at",
    statsField: "timestamps.created_at",

    getTenantAggregates(events: EsHit[]): Map<string, Set<string>> {
      const map = new Map<string, Set<string>>();
      for (const raw of events) {
        const doc = raw as unknown as EsDspyStepDoc;
        const aggId = `${doc.run_id}/${doc.index}`;
        let ids = map.get(doc.project_id);
        if (!ids) {
          ids = new Set();
          map.set(doc.project_id, ids);
        }
        ids.add(aggId);
      }
      return map;
    },

    aggregate(events: EsHit[]): Map<string, EsDspyStepDoc> {
      const aggregates = new Map<string, EsDspyStepDoc>();
      for (const raw of events) {
        const doc = raw as unknown as EsDspyStepDoc;
        const key = `${doc.project_id}/${doc.run_id}/${doc.index}`;
        aggregates.set(key, doc);
      }
      return aggregates;
    },

    buildCommands() {
      return [];
    },

    processAggregate(
      doc: EsDspyStepDoc,
      _aggregateId: string,
    ): DirectWriteResult {
      const tenantId = doc.project_id;
      const createdAt = toEpochMs(doc.timestamps.created_at);
      const insertedAt = toEpochMs(doc.timestamps.inserted_at);
      const updatedAt = toEpochMs(doc.timestamps.updated_at);

      const llmCalls: DspyLlmCallData[] = (doc.llm_calls ?? []).map((c) => ({
        hash: c.hash,
        __class__: c.__class__,
        response: c.response,
        model: c.model ?? null,
        prompt_tokens: c.prompt_tokens ?? null,
        completion_tokens: c.completion_tokens ?? null,
        cost: c.cost ?? null,
      }));

      const stepData: DspyStepData = {
        tenantId,
        experimentId: doc.experiment_id,
        runId: doc.run_id,
        stepIndex: doc.index,
        workflowVersionId: doc.workflow_version_id ?? null,
        score: doc.score,
        label: doc.label,
        optimizerName: doc.optimizer.name,
        optimizerParameters: doc.optimizer.parameters,
        predictors: doc.predictors,
        examples: doc.examples,
        llmCalls,
        createdAt,
        insertedAt,
        updatedAt,
      };

      // Create a minimal event record for ExistenceChecker dedup
      const eventRecord: EventRecord = {
        TenantId: tenantId,
        AggregateType: "dspy_step",
        AggregateId: `${doc.run_id}/${doc.index}`,
        EventId: nanoid(),
        EventTimestamp: createdAt,
        EventOccurredAt: createdAt,
        EventType: "dspy_step_migrated",
        EventVersion: "1",
        EventPayload: {},
        ProcessingTraceparent: "",
        IdempotencyKey: `${tenantId}:${doc.run_id}:${doc.index}:migrated`,
      };

      const summary = computeLlmSummary(llmCalls);

      const projectionWrites: Array<() => Promise<void>> = [
        () => deps.dspyStepRepository.insertStepDirect(stepData),
      ];

      return {
        eventRecords: [eventRecord],
        projectionWrites,
        commandCount: 1,
        projectionState: { ...stepData, llmSummary: summary },
      };
    },
  };
}
