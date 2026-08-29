import type {
  AnomalyAlertDispatchRecord,
  AnomalyRule,
  SpendSpikeEvaluationResult,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";
import { AnomalyAlertHttpPort } from "../../ports/anomaly-alert-http.port";
import {
  AnomalySpendReaderPort,
  type AnomalySpendSourceFilter,
  SpendSpikeAnomalyRepository,
} from "../../ports/spend-spike-anomaly.port";
import { AnomalyAlertDispatcherService } from "../anomaly-alert-dispatcher.service";
import { SpendSpikeAnomalyEvaluatorService } from "../spend-spike-anomaly-evaluator.service";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function rule(overrides: Partial<AnomalyRule> = {}): AnomalyRule {
  return {
    id: "rule-1",
    organizationId: "organization-1",
    scope: "organization",
    scopeId: "organization-1",
    name: "Spend spike",
    description: null,
    severity: "warning",
    ruleType: "spend_spike",
    thresholdConfig: {
      windowSec: 3600,
      ratioVsBaseline: 2,
      minBaselineUsd: 1,
    },
    destinationConfig: {},
    status: "active",
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdById: "user-1",
    ...overrides,
  };
}

class MemoryAnomalyRepository extends SpendSpikeAnomalyRepository {
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
      detectedAt: NOW,
    }),
  );
  readonly recordDispatch = vi.fn(async () => undefined);
  tenantId: string | null = "governance-project";
  hasOpen = false;

  constructor(private readonly rules: AnomalyRule[]) {
    super();
  }

  async listActiveRules(): Promise<AnomalyRule[]> {
    return this.rules;
  }

  async tryResolveGovernanceTenantId(): Promise<string | null> {
    return this.tenantId;
  }

  async hasOpenAlert(): Promise<boolean> {
    return this.hasOpen;
  }
}

class FixedSpendReader extends AnomalySpendReaderPort {
  readonly findSpendTotals = vi.fn(
    async (_input: {
      tenantId: string;
      windowStart: Date;
      windowEnd: Date;
      baselineStart: Date;
      sourceFilter: AnomalySpendSourceFilter;
    }) => ({ currentSpend: 10, baselineSpend: 6 }),
  );
}

class SuccessfulHttpPort extends AnomalyAlertHttpPort {
  async post() {
    return { status: 200, ok: true, statusText: "OK" };
  }
}

function createService(
  repository: MemoryAnomalyRepository,
  spend: FixedSpendReader = new FixedSpendReader(),
) {
  return {
    service: SpendSpikeAnomalyEvaluatorService.create({
      repository,
      spend,
      dispatcher: AnomalyAlertDispatcherService.create({
        http: new SuccessfulHttpPort(),
        retryBackoffMs: 0,
      }),
    }),
    spend,
  };
}

describe("SpendSpikeAnomalyEvaluatorService", () => {
  it("persists a firing decision before recording dispatch", async () => {
    const repository = new MemoryAnomalyRepository([rule()]);
    const { service } = createService(repository);

    await expect(service.evaluateAll({ now: NOW })).resolves.toEqual({
      rulesEvaluated: 1,
      alertsFired: 1,
      skipped: {},
    });
    expect(repository.createAlert).toHaveBeenCalledOnce();
    expect(repository.recordDispatch).toHaveBeenCalledWith({
      alertId: "alert-1",
      detail: {
        dispatch: "log_only",
        dispatchOutcomes: [],
      },
    });
  });

  it("deduplicates an open alert before persistence", async () => {
    const repository = new MemoryAnomalyRepository([rule()]);
    repository.hasOpen = true;
    const { service } = createService(repository);

    const summary = await service.evaluateAll({ now: NOW });

    expect(summary.skipped).toEqual({ skip_dedup: 1 });
    expect(repository.createAlert).not.toHaveBeenCalled();
  });

  it("quarantines invalid stored configuration without reading spend", async () => {
    const repository = new MemoryAnomalyRepository([
      rule({ thresholdConfig: { window_sec: 3600 } }),
    ]);
    const { service, spend } = createService(repository);

    const summary = await service.evaluateAll({ now: NOW });

    expect(summary.skipped).toEqual({ skip_invalid_config: 1 });
    expect(spend.findSpendTotals).not.toHaveBeenCalled();
  });

  it("skips organizations without a governance tenant", async () => {
    const repository = new MemoryAnomalyRepository([rule()]);
    repository.tenantId = null;
    const { service, spend } = createService(repository);

    const summary = await service.evaluateAll({ now: NOW });

    expect(summary.skipped).toEqual({ skip_no_data: 1 });
    expect(spend.findSpendTotals).not.toHaveBeenCalled();
  });

  it("passes a source scope as structured data rather than SQL", async () => {
    const repository = new MemoryAnomalyRepository([
      rule({ scope: "source", scopeId: "source-1" }),
    ]);
    const { service, spend } = createService(repository);

    await service.evaluateAll({ now: NOW });

    expect(spend.findSpendTotals).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFilter: { type: "source", id: "source-1" },
      }),
    );
  });
});
