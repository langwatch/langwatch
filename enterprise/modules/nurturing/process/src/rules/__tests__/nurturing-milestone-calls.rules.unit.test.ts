// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What main's trace, simulation and evaluation syncs tell Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import {
  fireEvaluationCompleted,
  fireFirstTraceIntegrated,
  fireSimulationRunFinished,
} from "../nurturing-milestone-calls.rules.ts";

const at = Date.UTC(2026, 8, 29);
const source = { sourceEventId: "event-1", tenantId: "project-1", occurredAt: at };
const seconds = Math.floor(at / 1000);

describe("fireFirstTraceIntegrated", () => {
  it("identifies the first trace's milestone and tracks it against the project", () => {
    const calls = fireFirstTraceIntegrated({
      ...source,
      kind: "first_trace_integrated",
      userId: "user-1",
      projectId: "project-1",
      sdkLanguage: "python",
      sdkFramework: "openai",
    });

    expect(calls).toEqual([
      {
        type: "identify",
        userId: "user-1",
        traits: {
          has_traces: true,
          sdk_language: "python",
          sdk_framework: "openai",
          first_trace_at: seconds,
        },
      },
      {
        type: "track",
        userId: "user-1",
        event: "first_trace_integrated",
        properties: { sdk_language: "python", sdk_framework: "openai", project_id: "project-1" },
      },
    ]);
  });
});

describe("fireSimulationRunFinished", () => {
  const run = {
    ...source,
    kind: "simulation_run_finished" as const,
    userId: "user-1",
    projectId: "project-1",
    organizationRunCount: 3,
  };

  it("identifies the milestone and tracks first_simulation_ran for the first run", () => {
    expect(fireSimulationRunFinished({ ...run, first: true })).toEqual([
      {
        type: "identify",
        userId: "user-1",
        traits: { has_simulations: true, simulation_count: 3, first_simulation_at: seconds },
      },
      {
        type: "track",
        userId: "user-1",
        event: "first_simulation_ran",
        properties: { project_id: "project-1" },
      },
    ]);
  });

  it("identifies only the count for a later run", () => {
    expect(fireSimulationRunFinished({ ...run, first: false })).toEqual([
      {
        type: "identify",
        userId: "user-1",
        traits: { simulation_count: 3, last_simulation_at: seconds },
      },
    ]);
  });
});

describe("fireEvaluationCompleted", () => {
  const evaluation = {
    ...source,
    kind: "evaluation_completed" as const,
    userId: "user-1",
    projectId: "project-1",
    organizationEvaluationCount: 4,
    evaluatorType: "ragas",
    evaluationId: "evaluation-1",
    score: 0.5,
    passed: true,
  };
  const ran = {
    type: "track",
    userId: "user-1",
    event: "evaluation_ran",
    properties: { evaluation_id: "evaluation-1", score: 0.5, passed: true, count: 1 },
  };

  it("identifies the milestone, tracks first_evaluation_created, then evaluation_ran", () => {
    expect(fireEvaluationCompleted({ ...evaluation, first: true })).toEqual([
      {
        type: "identify",
        userId: "user-1",
        traits: { has_evaluations: true, evaluation_count: 4, first_evaluation_at: seconds },
      },
      {
        type: "track",
        userId: "user-1",
        event: "first_evaluation_created",
        properties: { evaluation_type: "ragas", project_id: "project-1" },
      },
      ran,
    ]);
  });

  it("identifies only the count for a later batch, then evaluation_ran with its size", () => {
    const calls = fireEvaluationCompleted({ ...evaluation, first: false, evaluationsCounted: 2 });

    expect(calls).toEqual([
      {
        type: "identify",
        userId: "user-1",
        traits: { evaluation_count: 4, last_evaluation_at: seconds },
      },
      { ...ran, properties: { ...ran.properties, count: 2 } },
    ]);
  });
});
