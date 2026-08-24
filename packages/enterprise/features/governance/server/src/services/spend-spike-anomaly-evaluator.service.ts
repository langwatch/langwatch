import {
  type AnomalyRule,
  evaluateSpendSpike,
  safeParseSpendSpikeThresholdConfig,
  type SpendSpikeEvaluationResult,
} from "@langwatch/enterprise-governance-contract";
import {
  GovernanceDiagnosticsPort,
  NullGovernanceDiagnosticsPort,
} from "../ports/governance-diagnostics.port";
import type {
  AnomalySpendReaderPort,
  AnomalySpendSourceFilter,
  SpendSpikeAnomalyRepository,
} from "../ports/spend-spike-anomaly.port";
import type { AnomalyAlertDispatcherService } from "./anomaly-alert-dispatcher.service";

const BASELINE_WINDOWS = 6;

export type SpendSpikeEvaluationSummary = {
  rulesEvaluated: number;
  alertsFired: number;
  skipped: Record<string, number>;
};

export class SpendSpikeAnomalyEvaluatorService {
  private constructor(
    private readonly repository: SpendSpikeAnomalyRepository,
    private readonly spend: AnomalySpendReaderPort | undefined,
    private readonly dispatcher: AnomalyAlertDispatcherService,
    private readonly diagnostics: GovernanceDiagnosticsPort,
  ) {}

  static create(options: {
    repository: SpendSpikeAnomalyRepository;
    spend?: AnomalySpendReaderPort;
    dispatcher: AnomalyAlertDispatcherService;
    diagnostics?: GovernanceDiagnosticsPort;
  }): SpendSpikeAnomalyEvaluatorService {
    return new SpendSpikeAnomalyEvaluatorService(
      options.repository,
      options.spend,
      options.dispatcher,
      options.diagnostics ?? new NullGovernanceDiagnosticsPort(),
    );
  }

  async evaluateAll(
    input: { now?: Date } = {},
  ): Promise<SpendSpikeEvaluationSummary> {
    const now = input.now ?? new Date();
    const rules = await this.repository.listActiveRules();
    const skipped: Record<string, number> = {};
    let alertsFired = 0;

    for (const rule of rules) {
      try {
        const result = await this.evaluateRule(rule, now);
        if (result.decision === "fire") {
          await this.persistAndDispatch(rule, result);
          alertsFired += 1;
        } else {
          skipped[result.decision] = (skipped[result.decision] ?? 0) + 1;
        }
      } catch (error) {
        this.diagnostics.warn("Spend spike rule evaluation failed", {
          ruleId: rule.id,
          organizationId: rule.organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { rulesEvaluated: rules.length, alertsFired, skipped };
  }

  private async evaluateRule(
    rule: AnomalyRule,
    now: Date,
  ): Promise<SpendSpikeEvaluationResult> {
    const parsed = safeParseSpendSpikeThresholdConfig(rule.thresholdConfig);
    if (!parsed.ok) {
      this.diagnostics.warn(
        "Spend spike rule has invalid threshold configuration",
        {
          ruleId: rule.id,
          organizationId: rule.organizationId,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      );
      return noDataResult(
        rule,
        now,
        "skip_invalid_config",
        "thresholdConfig failed strict validation — rule is quarantined until repaired",
      );
    }

    const windowMs = parsed.data.windowSec * 1_000;
    const windowEnd = now;
    const windowStart = new Date(now.getTime() - windowMs);
    const baselineStart = new Date(
      windowStart.getTime() - BASELINE_WINDOWS * windowMs,
    );
    const tenantId = await this.repository.resolveGovernanceTenantId(
      rule.organizationId,
    );
    if (!tenantId) {
      return noDataResult(
        rule,
        now,
        "skip_no_data",
        "Organization has no governance tenant",
        windowStart,
      );
    }
    if (!this.spend) {
      return noDataResult(
        rule,
        now,
        "skip_no_data",
        "Spend storage is not configured",
        windowStart,
      );
    }

    const totals = await this.spend.findSpendTotals({
      tenantId,
      windowStart,
      windowEnd,
      baselineStart,
      sourceFilter: sourceFilterFor(rule),
    });
    const hasOpenAlertInWindow = await this.repository.hasOpenAlert({
      ruleId: rule.id,
      since: windowStart,
    });

    return evaluateSpendSpike({
      ruleId: rule.id,
      organizationId: rule.organizationId,
      config: parsed.data,
      currentSpendUsd: totals.currentSpend,
      baselineSpendUsd: totals.baselineSpend / BASELINE_WINDOWS,
      hasOpenAlertInWindow,
      windowStart,
      windowEnd,
    });
  }

  private async persistAndDispatch(
    rule: AnomalyRule,
    result: SpendSpikeEvaluationResult,
  ): Promise<void> {
    const alert = await this.repository.createAlert({ rule, result });
    let dispatchTag: string;
    let dispatchOutcomes: unknown[] = [];
    try {
      const dispatch = await this.dispatcher.dispatchAlert({
        rule: {
          id: rule.id,
          name: rule.name,
          ruleType: rule.ruleType,
          severity: rule.severity,
          organizationId: rule.organizationId,
          destinationConfig: rule.destinationConfig,
        },
        alert,
      });
      dispatchTag = dispatch.dispatchTag;
      dispatchOutcomes = dispatch.outcomes;
    } catch (error) {
      dispatchTag = "failed_dispatcher_error";
      this.diagnostics.warn("Anomaly alert dispatcher failed", {
        ruleId: rule.id,
        alertId: alert.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await this.repository.recordDispatch({
      alertId: alert.id,
      detail: {
        ...asRecord(alert.detail),
        dispatch: dispatchTag,
        dispatchOutcomes,
      },
    });
  }
}

function sourceFilterFor(rule: AnomalyRule): AnomalySpendSourceFilter {
  if (rule.scope === "source") return { type: "source", id: rule.scopeId };
  if (rule.scope === "source_type") {
    return { type: "source_type", id: rule.scopeId };
  }
  return { type: "all" };
}

function noDataResult(
  rule: AnomalyRule,
  windowEnd: Date,
  decision: "skip_no_data" | "skip_invalid_config",
  reason: string,
  windowStart: Date = windowEnd,
): SpendSpikeEvaluationResult {
  return {
    ruleId: rule.id,
    organizationId: rule.organizationId,
    decision,
    reason,
    currentSpendUsd: 0,
    baselineSpendUsd: 0,
    windowStart,
    windowEnd,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
