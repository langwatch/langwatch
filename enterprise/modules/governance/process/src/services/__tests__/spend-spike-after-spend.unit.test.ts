import { createApiFixture } from "@langwatch/api-fixture";
import type {
  AnomalyAlertDispatchRecord,
  AnomalyRule,
  SpendSpikeEvaluationResult,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { createGovernanceProjectApi } from "../../__tests__/testing.ts";
import type { GovernanceTraceSummary } from "../../app/governance.members.ts";
import { MemoryAnomalySpendRepository } from "../../repositories/memory/memory.anomaly-spend.repository.ts";
import { MemoryOcsfEventsRepository } from "../../repositories/memory/memory.ocsf-events.repository.ts";
import { SpendSpikeAnomalyRepository } from "../../repositories/spend-spike-anomaly.repository.ts";
import { AnomalyAlertDispatcherService } from "../anomaly-alert-dispatcher.service.ts";
import { GovernanceTraceFactsService } from "../governance-trace-facts.service.ts";
import { SpendSpikeAnomalyEvaluatorService } from "../spend-spike-anomaly-evaluator.service.ts";

const NOW = Temporal.Instant.from("2026-08-24T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

const rule: AnomalyRule = {
  id: "rule-1",
  organizationId: "organization-1",
  scope: "organization",
  scopeId: "organization-1",
  name: "Spend spike",
  description: null,
  severity: "warning",
  ruleType: "spend_spike",
  thresholdConfig: { windowSec: 3600, ratioVsBaseline: 2, minBaselineUsd: 1 },
  destinationConfig: {},
  status: "active",
  archivedAt: null,
  createdAt: new Date(NOW.epochMilliseconds),
  updatedAt: new Date(NOW.epochMilliseconds),
  createdById: "user-1",
};

class OneRuleRepository extends SpendSpikeAnomalyRepository {
  readonly createAlert = vi.fn(
    async (input: {
      rule: AnomalyRule;
      result: SpendSpikeEvaluationResult;
    }): Promise<AnomalyAlertDispatchRecord> => ({
      id: "alert-1",
      triggerWindowStart: input.result.windowStart,
      triggerWindowEnd: input.result.windowEnd,
      triggerSpendUsd: String(input.result.currentSpendUsd),
      triggerEventCount: null,
      detail: { dispatch: "pending" },
      detectedAt: new Date(NOW.epochMilliseconds),
    }),
  );
  readonly recordDispatch = vi.fn(async () => undefined);

  async findActiveRules(): Promise<AnomalyRule[]> {
    return [rule];
  }

  async hasOpenAlert(): Promise<boolean> {
    return false;
  }
}

function governanceTrace({
  traceId,
  agoMs,
  cost,
}: {
  traceId: string;
  agoMs: number;
  cost: number;
}): GovernanceTraceSummary {
  return {
    traceId,
    occurredAt: NOW.epochMilliseconds - agoMs,
    totalCost: cost,
    totalPromptTokenCount: 10,
    totalCompletionTokenCount: 5,
    models: ["model-1"],
    attributes: {
      "langwatch.origin.kind": "ingestion_source",
      "langwatch.ingestion_source.id": "source-1",
      "langwatch.ingestion_source.source_type": "otel_generic",
    },
  };
}

describe("given a spend_spike rule over the governance tenant", () => {
  /** @scenario "A spend spike fires once the spend has landed" */
  it("fires only once the traces' spend has landed in governance_kpis", async () => {
    const spend = MemoryAnomalySpendRepository.create();
    const repository = new OneRuleRepository();
    const evaluator = SpendSpikeAnomalyEvaluatorService.create({
      repository,
      projects: createGovernanceProjectApi(() => "governance-project"),
      spend,
      dispatcher: AnomalyAlertDispatcherService.create({
        http: { post: async () => ({ status: 200, ok: true, statusText: "OK" }) },
        retryBackoffMs: 0,
      }),
    });

    expect((await evaluator.evaluateAll({ now: NOW })).alertsFired).toBe(0);

    const traces = [governanceTrace({ traceId: "spike", agoMs: HOUR_MS / 2, cost: 10 })];
    for (let hour = 1; hour <= 6; hour += 1) {
      traces.push(
        governanceTrace({
          traceId: `baseline-${hour}`,
          agoMs: hour * HOUR_MS + HOUR_MS / 2,
          cost: 1,
        }),
      );
    }
    await GovernanceTraceFactsService.create({
      kpis: spend,
      ocsf: MemoryOcsfEventsRepository.create(),
      traces: createApiFixture<TraceApi>({}),
      projects: createApiFixture<ProjectApi>({}),
      diagnostics: { warn: () => {} },
    }).record({ tenantId: "governance-project", summaries: traces });

    expect((await evaluator.evaluateAll({ now: NOW })).alertsFired).toBe(1);
    expect(repository.createAlert).toHaveBeenCalledOnce();
  });
});
