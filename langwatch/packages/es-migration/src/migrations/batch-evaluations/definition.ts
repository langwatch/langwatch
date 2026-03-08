import type { Event } from "~/server/event-sourcing/domain/types.js";
import { StartExperimentRunCommand } from "~/server/event-sourcing/pipelines/experiment-run-processing/commands/startExperimentRun.command.js";
import { RecordTargetResultCommand } from "~/server/event-sourcing/pipelines/experiment-run-processing/commands/recordTargetResult.command.js";
import { RecordEvaluatorResultCommand } from "~/server/event-sourcing/pipelines/experiment-run-processing/commands/recordEvaluatorResult.command.js";
import { CompleteExperimentRunCommand } from "~/server/event-sourcing/pipelines/experiment-run-processing/commands/completeExperimentRun.command.js";
import { createExperimentRunStateFoldProjection } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunState.foldProjection.js";
import type { ESBatchEvaluation } from "~/server/experiments/types.js";
import type { CommandToProcess, EsHit, MigrationDefinition } from "../../lib/types.js";

/** Normalize timestamp to milliseconds. Handles string and number inputs. */
function toEpochMs(ts: number | string): number {
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (Number.isNaN(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

type EsBatchEvaluationDoc = ESBatchEvaluation & EsHit;

const startHandler = new StartExperimentRunCommand();
const targetResultHandler = new RecordTargetResultCommand();
const evaluatorResultHandler = new RecordEvaluatorResultCommand();
const completeHandler = new CompleteExperimentRunCommand();

export function createEvaluationMigrationDefinition(): MigrationDefinition<EsBatchEvaluationDoc> {
  return {
    name: "evaluations",
    esIndex: "search-batch-evaluations-alias",
    esSort: [{ "timestamps.created_at": "asc" }, { run_id: "asc" }],
    aggregateType: "experiment_run",
    timestampField: "timestamps.created_at",
    statsField: "timestamps.created_at",

    computeProjection(events: Event[]): unknown {
      const noopStore = { get: async () => null, store: async () => {} };
      const proj = createExperimentRunStateFoldProjection({ store: noopStore as any });
      let state = proj.init();
      for (const event of events) {
        state = proj.apply(state, event as any);
      }
      return state;
    },

    getTenantAggregates(events: EsHit[]): Map<string, Set<string>> {
      const map = new Map<string, Set<string>>();
      for (const raw of events) {
        const doc = raw as unknown as EsBatchEvaluationDoc;
        const aggId = `${doc.experiment_id}:${doc.run_id}`;
        let ids = map.get(doc.project_id);
        if (!ids) {
          ids = new Set();
          map.set(doc.project_id, ids);
        }
        ids.add(aggId);
      }
      return map;
    },

    aggregate(events: EsHit[]): Map<string, EsBatchEvaluationDoc> {
      // Each ES document is already a complete aggregate — no buffering needed
      const aggregates = new Map<string, EsBatchEvaluationDoc>();
      for (const raw of events) {
        const doc = raw as unknown as EsBatchEvaluationDoc;
        const key = `${doc.experiment_id}:${doc.run_id}`;
        aggregates.set(key, doc);
      }
      return aggregates;
    },

    buildCommands(doc: EsBatchEvaluationDoc): CommandToProcess[] {
      const commands: CommandToProcess[] = [];
      const tenantId = doc.project_id;
      const occurredAt = toEpochMs(doc.timestamps.created_at);
      // 1. StartExperimentRunCommand
      const targets = (doc.targets ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        promptId: t.prompt_id ?? null,
        promptVersion: t.prompt_version ?? null,
        agentId: t.agent_id ?? null,
        evaluatorId: t.evaluator_id ?? null,
        model: t.model ?? null,
        metadata: t.metadata ?? null,
      }));

      commands.push({
        payload: {
          tenantId,
          runId: doc.run_id,
          experimentId: doc.experiment_id,
          workflowVersionId: doc.workflow_version_id ?? null,
          total: doc.total ?? doc.dataset.length,
          targets,
          occurredAt,
        },
        commandType: StartExperimentRunCommand.schema.type,
        commandSchema: StartExperimentRunCommand.schema,
        handler: startHandler,
        getAggregateId: StartExperimentRunCommand.getAggregateId,
        commandName: "startExperimentRun",
        idempotencyKey: `${tenantId}:${doc.run_id}:start`,
      });

      // 2. RecordTargetResultCommand × N (one per dataset entry)
      for (const entry of doc.dataset) {
        const targetId = entry.target_id ?? "default";
        commands.push({
          payload: {
            tenantId,
            runId: doc.run_id,
            experimentId: doc.experiment_id,
            index: entry.index,
            targetId,
            entry: entry.entry,
            predicted: entry.predicted ?? null,
            cost: entry.cost ?? null,
            duration: entry.duration ?? null,
            error: entry.error ?? null,
            traceId: entry.trace_id ?? null,
            occurredAt,
          },
          commandType: RecordTargetResultCommand.schema.type,
          commandSchema: RecordTargetResultCommand.schema,
          handler: targetResultHandler,
          getAggregateId: RecordTargetResultCommand.getAggregateId,
          commandName: "recordTargetResult",
          idempotencyKey: `${tenantId}:${doc.run_id}:target:${entry.index}:${targetId}`,
        });
      }

      // 3. RecordEvaluatorResultCommand × N (one per evaluation)
      for (const evaluation of doc.evaluations) {
        const targetId = evaluation.target_id ?? "default";
        commands.push({
          payload: {
            tenantId,
            runId: doc.run_id,
            experimentId: doc.experiment_id,
            index: evaluation.index,
            targetId,
            evaluatorId: evaluation.evaluator,
            evaluatorName: evaluation.name ?? null,
            status: evaluation.status,
            score:
              typeof evaluation.score === "number" ? evaluation.score : null,
            label: evaluation.label ?? null,
            passed: evaluation.passed ?? null,
            details: evaluation.details ?? null,
            cost: evaluation.cost ?? null,
            inputs: evaluation.inputs ?? null,
            duration: evaluation.duration ?? null,
            occurredAt,
          },
          commandType: RecordEvaluatorResultCommand.schema.type,
          commandSchema: RecordEvaluatorResultCommand.schema,
          handler: evaluatorResultHandler,
          getAggregateId: RecordEvaluatorResultCommand.getAggregateId,
          commandName: "recordEvaluatorResult",
          idempotencyKey: `${tenantId}:${doc.run_id}:eval:${evaluation.index}:${targetId}:${evaluation.evaluator}`,
        });
      }

      // 4. CompleteExperimentRunCommand
      commands.push({
        payload: {
          tenantId,
          runId: doc.run_id,
          experimentId: doc.experiment_id,
          finishedAt: doc.timestamps.finished_at
            ? toEpochMs(doc.timestamps.finished_at)
            : null,
          stoppedAt: doc.timestamps.stopped_at
            ? toEpochMs(doc.timestamps.stopped_at)
            : null,
          occurredAt,
        },
        commandType: CompleteExperimentRunCommand.schema.type,
        commandSchema: CompleteExperimentRunCommand.schema,
        handler: completeHandler,
        getAggregateId: CompleteExperimentRunCommand.getAggregateId,
        commandName: "completeExperimentRun",
        idempotencyKey: `${tenantId}:${doc.run_id}:complete`,
      });

      return commands;
    },
  };
}
