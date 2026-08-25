import {
  GOVERNANCE_ATTR,
  isGovernanceOriginTrace,
} from "@langwatch/enterprise-governance-contract";
import {
  GovernanceKpiContributionPort,
  GovernanceSubscriberDiagnosticsPort,
  type GovernanceKpiContribution,
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
} from "../ports/governance-subscriber.port";

export const GOVERNANCE_KPIS_SYNC_WINDOW_MS = 30_000;

export class GovernanceKpisSubscriber {
  private constructor(
    private readonly contributions: GovernanceKpiContributionPort,
    private readonly diagnostics: GovernanceSubscriberDiagnosticsPort,
  ) {}

  static create(options: {
    contributions: GovernanceKpiContributionPort;
    diagnostics: GovernanceSubscriberDiagnosticsPort;
  }): GovernanceKpisSubscriber {
    return new GovernanceKpisSubscriber(
      options.contributions,
      options.diagnostics,
    );
  }

  when(_event: GovernanceTraceEvent, context: GovernanceTraceContext): boolean {
    return isGovernanceOriginTrace(context.state.attributes);
  }

  async handle(
    _event: GovernanceTraceEvent,
    context: GovernanceTraceContext,
  ): Promise<void> {
    const contribution = this.contribution(context);
    if (!contribution) return;
    try {
      await this.contributions.insertContribution(contribution);
    } catch (error) {
      this.diagnostics.capture(error);
    }
  }

  private contribution(
    context: GovernanceTraceContext,
  ): GovernanceKpiContribution | undefined {
    const { tenantId, state } = context;
    if (!isGovernanceOriginTrace(state.attributes)) return undefined;
    const sourceId = state.attributes[GOVERNANCE_ATTR.INGESTION_SOURCE_ID];
    if (!sourceId) {
      this.diagnostics.warn({
        code: "governance_kpi_missing_source_id",
        tenantId,
        traceId: state.traceId,
      });
      return undefined;
    }
    if (state.occurredAt <= 0) return undefined;
    const hourMs = 60 * 60 * 1_000;
    return {
      tenantId,
      sourceId,
      sourceType:
        state.attributes[GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE] ?? "unknown",
      hourBucket: new Date(Math.floor(state.occurredAt / hourMs) * hourMs),
      traceId: state.traceId,
      spendUsd: state.totalCost ?? 0,
      promptTokens: state.totalPromptTokenCount ?? 0,
      completionTokens: state.totalCompletionTokenCount ?? 0,
      lastEventOccurredAt: new Date(state.occurredAt),
    };
  }
}
