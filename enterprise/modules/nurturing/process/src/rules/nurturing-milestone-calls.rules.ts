// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";

/** Main's trace sync: the first trace's milestone, as the trace metadata subscriber saw it. */
export function fireFirstTraceIntegrated(
  signal: NurturingSignalOf<"first_trace_integrated">,
): CioBatchCall[] {
  const { userId, projectId, sdkLanguage, sdkFramework } = signal;
  return [
    {
      type: "identify",
      userId,
      traits: {
        has_traces: true,
        sdk_language: sdkLanguage,
        sdk_framework: sdkFramework,
        first_trace_at: unixSecondsOf(signal.occurredAt),
      },
    },
    {
      type: "track",
      userId,
      event: "first_trace_integrated",
      properties: {
        sdk_language: sdkLanguage,
        sdk_framework: sdkFramework,
        project_id: projectId,
      },
    },
  ];
}

/** Main's simulation sync: the organization's first run is a milestone, later ones a count. */
export function fireSimulationRunFinished(
  signal: NurturingSignalOf<"simulation_run_finished">,
): CioBatchCall[] {
  const { userId, projectId, organizationRunCount } = signal;
  const at = unixSecondsOf(signal.occurredAt);
  if (!signal.first) {
    return [
      {
        type: "identify",
        userId,
        traits: { simulation_count: organizationRunCount, last_simulation_at: at },
      },
    ];
  }
  return [
    {
      type: "identify",
      userId,
      traits: {
        has_simulations: true,
        simulation_count: organizationRunCount,
        first_simulation_at: at,
      },
    },
    {
      type: "track",
      userId,
      event: "first_simulation_ran",
      properties: { project_id: projectId },
    },
  ];
}

/** Main's evaluation sync once per batch; `first` picks the milestone, `count` the batch's. */
export function fireEvaluationCompleted(
  signal: NurturingSignalOf<"evaluation_completed">,
): CioBatchCall[] {
  const { userId, projectId, organizationEvaluationCount: count } = signal;
  const at = unixSecondsOf(signal.occurredAt);
  const calls: CioBatchCall[] = signal.first
    ? [
        {
          type: "identify",
          userId,
          traits: { has_evaluations: true, evaluation_count: count, first_evaluation_at: at },
        },
        {
          type: "track",
          userId,
          event: "first_evaluation_created",
          properties: { evaluation_type: signal.evaluatorType, project_id: projectId },
        },
      ]
    : [{ type: "identify", userId, traits: { evaluation_count: count, last_evaluation_at: at } }];
  calls.push({
    type: "track",
    userId,
    event: "evaluation_ran",
    properties: {
      evaluation_id: signal.evaluationId,
      score: signal.score,
      passed: signal.passed,
      count: signal.evaluationsCounted ?? 1,
    },
  });
  return calls;
}

/**
 * The Company's evaluation facts, sent before the debounce: the person-level update is
 * debounced per tenant, but a skipped batch must still keep the organization's count current.
 */
export function fireEvaluationCompany(signal: NurturingSignal): CioBatchCall[] {
  if (signal.kind !== "evaluation_completed" || !signal.organizationId) return [];
  return [
    {
      type: "group",
      userId: signal.userId,
      groupId: signal.organizationId,
      traits: {
        has_evaluation_results: true,
        evaluation_count: signal.organizationEvaluationCount,
        ...(signal.first ? { first_evaluation_at: unixSecondsOf(signal.occurredAt) } : {}),
      },
    },
  ];
}
