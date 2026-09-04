/**
 * Turns what a run produced into the Eventing command payloads that store
 * it. Model attribution is pinned at run start, not read live, so an
 * evaluator edited later does not retroactively misattribute a historical
 * run. A falsy target output persists as a value; only null/undefined
 * become a null prediction.
 */

import type {
  ESBatchEvaluationTarget,
  EvaluationsV3State,
  EvaluationV3Event,
  RecordEvaluatorResultCommandData,
  RecordTargetResultCommandData,
} from "@langwatch/experiment-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import {
  type LoadedEvaluators,
  type LoadedWorkflow,
  promptLoadKey,
  workflowLoadKey,
} from "./experiment-execution-data.service";

export class ExperimentResultDispatchService {
  static create(): ExperimentResultDispatchService {
    return new ExperimentResultDispatchService();
  }

  private constructor() {}

  /**
   * Build the per-target metadata stored with a run. Model attribution:
   * edited `localPromptConfig.llm.model` wins over the loaded prompt's.
   * Exported for unit testing — a regression here blanks the model column.
   */
  buildTargetMetadata({
    targets,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
    loadedWorkflows,
  }: {
    targets: EvaluationsV3State["targets"];
    loadedPrompts: Map<string, VersionedPrompt>;
    loadedAgents: Map<string, TypedAgent>;
    loadedEvaluators?: LoadedEvaluators;
    loadedWorkflows?: Map<string, LoadedWorkflow>;
  }): ESBatchEvaluationTarget[] {
    return targets.map((t) => {
      const model = this.targetModel({ target: t, loadedPrompts, loadedEvaluators });
      const name = this.targetName({
        target: t,
        loadedPrompts,
        loadedAgents,
        loadedEvaluators,
        loadedWorkflows,
      });

      return {
        id: t.id,
        name: name ?? t.id,
        type: t.type,
        prompt_id: t.promptId ?? null,
        prompt_version: t.promptVersionNumber ?? null,
        agent_id: t.dbAgentId ?? null,
        evaluator_id: t.targetEvaluatorId ?? null,
        model,
      };
    });
  }

  private targetModel({
    target: t,
    loadedPrompts,
    loadedEvaluators,
  }: {
    target: EvaluationsV3State["targets"][number];
    loadedPrompts: Map<string, VersionedPrompt>;
    loadedEvaluators?: LoadedEvaluators;
  }): string | null {
    if (t.localPromptConfig?.llm?.model) {
      return t.localPromptConfig.llm.model;
    }

    if (t.type === "prompt" && t.promptId) {
      const loadedPrompt = loadedPrompts.get(promptLoadKey(t));
      if (loadedPrompt?.model) {
        return loadedPrompt.model;
      }
    }

    // Evaluator targets — the judge, recorded on the run for the same
    // reason a prompt target's model is: the config can be edited later,
    // and reading it live would retroactively misattribute every
    // historical run.
    if (t.type === "evaluator" && t.targetEvaluatorId) {
      // Unsaved edits first, as the prompt branch above and workflowBuilder
      // do — reading only the saved config ran on one model and recorded
      // another, breaking the leaderboard's self-preference check.
      const settings =
        (t.localEvaluatorConfig as { settings?: { model?: unknown } } | undefined)?.settings ??
        (
          loadedEvaluators?.get(t.targetEvaluatorId)?.config as
            | { settings?: { model?: unknown } }
            | undefined
        )?.settings;
      if (typeof settings?.model === "string" && settings.model) {
        return settings.model;
      }
    }

    return null;
  }

  private targetName({
    target: t,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
    loadedWorkflows,
  }: {
    target: EvaluationsV3State["targets"][number];
    loadedPrompts: Map<string, VersionedPrompt>;
    loadedAgents: Map<string, TypedAgent>;
    loadedEvaluators?: LoadedEvaluators;
    loadedWorkflows?: Map<string, LoadedWorkflow>;
  }): string | null {
    if (t.type === "prompt" && t.promptId) {
      return loadedPrompts.get(promptLoadKey(t))?.name ?? null;
    }

    if (t.type === "agent" && t.dbAgentId) {
      return loadedAgents.get(t.dbAgentId)?.name ?? null;
    }

    if (t.type === "evaluator" && t.targetEvaluatorId) {
      return loadedEvaluators?.get(t.targetEvaluatorId)?.name ?? null;
    }

    if (t.type === "workflow" && t.workflowId) {
      return loadedWorkflows?.get(workflowLoadKey(t))?.name ?? null;
    }

    return null;
  }

  /**
   * Build the recordTargetResult dispatch payload for a `target_result` or
   * cell-level `error` event. Exported for unit testing: falsy outputs
   * must persist as a value, and the raw thrown message is never stored.
   */
  tryBuildTargetResultDispatch({
    tenantId,
    runId,
    experimentId,
    event,
    datasetEntry,
    occurredAt,
  }: {
    tenantId: string;
    runId: string;
    experimentId: string;
    event: EvaluationV3Event;
    datasetEntry: Record<string, unknown>;
    occurredAt: number;
  }): RecordTargetResultCommandData | null {
    if (event.type === "target_result") {
      return {
        tenantId,
        runId,
        experimentId,
        index: event.rowIndex,
        targetId: event.targetId,
        entry: datasetEntry,
        predicted:
          event.output === null || event.output === undefined ? null : { output: event.output },
        cost: event.cost ?? null,
        duration: event.duration ?? null,
        error: event.error ?? null,
        domainError: event.domainError ?? null,
        traceId: event.traceId ?? null,
        occurredAt,
      };
    }

    if (event.type === "error" && event.rowIndex !== undefined && event.targetId) {
      return {
        tenantId,
        runId,
        experimentId,
        index: event.rowIndex,
        targetId: event.targetId,
        entry: datasetEntry,
        predicted: null,
        cost: null,
        duration: null,
        // The wire message: a handled failure's code, or the unnamed-failure
        // marker. Both are safe to read back; the thrown error's own words are
        // not, and are logged instead.
        error: event.message,
        domainError: event.domainError ?? null,
        traceId: event.traceId ?? null,
        occurredAt,
      };
    }

    return null;
  }

  /**
   * Build the recordEvaluatorResult dispatch payload. Exported for unit
   * testing: an evaluation that declines to score can still have spent
   * money, so cost is recorded even with no score.
   */
  buildEvaluatorResultDispatch({
    tenantId,
    runId,
    experimentId,
    event,
    result,
    evaluatorName,
    occurredAt,
  }: {
    tenantId: string;
    runId: string;
    experimentId: string;
    event: {
      rowIndex: number;
      targetId: string;
      evaluatorId: string;
      duration?: number | null;
      inputs?: Record<string, unknown> | null;
    };
    result: SingleEvaluationResult;
    evaluatorName: string | null;
    occurredAt: number;
  }): RecordEvaluatorResultCommandData {
    // Only an evaluation that actually scored has a verdict to report.
    const scored = result.status === "processed" ? result : null;
    // An error measured nothing and spent nothing; the other two statuses may
    // have spent without scoring.
    const billed = result.status === "error" ? null : result;

    return {
      tenantId,
      runId,
      experimentId,
      index: event.rowIndex,
      targetId: event.targetId,
      evaluatorId: event.evaluatorId,
      evaluatorName,
      status: result.status,
      score: scored?.score ?? null,
      label: scored?.label ?? null,
      passed: scored?.passed ?? null,
      details: result.status === "skipped" ? null : (result.details ?? null),
      cost: billed?.cost?.amount ?? null,
      inputs: event.inputs ?? null,
      duration: event.duration ?? null,
      occurredAt,
    };
  }
}
