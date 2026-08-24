import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  type QuarantineFillInput,
  type QuarantineFillStats,
} from "@langwatch/enterprise-governance-contract";
import {
  GovernanceDiagnosticsPort,
  NullGovernanceDiagnosticsPort,
} from "../ports/governance-diagnostics.port";
import type {
  QuarantineTenantPort,
  QuarantineTraceActivityPort,
} from "../ports/quarantine-fill.port";

export class QuarantineFillEvaluatorService {
  private constructor(
    private readonly tenant: QuarantineTenantPort,
    private readonly traceActivity: QuarantineTraceActivityPort | undefined,
    private readonly diagnostics: GovernanceDiagnosticsPort,
    private readonly now: () => number,
  ) {}

  static create(options: {
    tenant: QuarantineTenantPort;
    traceActivity?: QuarantineTraceActivityPort;
    diagnostics?: GovernanceDiagnosticsPort;
    now?: () => number;
  }): QuarantineFillEvaluatorService {
    return new QuarantineFillEvaluatorService(
      options.tenant,
      options.traceActivity,
      options.diagnostics ?? new NullGovernanceDiagnosticsPort(),
      options.now ?? Date.now,
    );
  }

  async evaluate(input: QuarantineFillInput): Promise<QuarantineFillStats> {
    const windowSeconds =
      input.windowSeconds ?? QUARANTINE_DEFAULT_WINDOW_SECONDS;
    const threshold = input.threshold ?? QUARANTINE_DEFAULT_THRESHOLD;
    const tenantId = await this.tenant.resolveTenantId(input.organizationId);
    if (!this.traceActivity) {
      throw new Error(
        "ClickHouse client is not available — check ClickHouse connection configuration",
      );
    }

    try {
      const rows = await this.traceActivity.findSpanCountsBySource({
        tenantId,
        sinceMs: this.now() - windowSeconds * 1_000,
      });
      const perSource = rows
        .filter(({ sourceId }) => sourceId.length > 0)
        .map(({ sourceId, spanCount }) => ({
          ingestionSourceId: sourceId,
          spanCount,
        }));
      const spanCount = perSource.reduce(
        (total, source) => total + source.spanCount,
        0,
      );
      const rate = (spanCount * 60) / Math.max(1, windowSeconds);
      return {
        windowSeconds,
        threshold,
        spanCount,
        rate,
        exceeded: rate >= threshold,
        perSource,
      };
    } catch (error) {
      this.diagnostics.warn(
        "quarantine fill evaluation failed — returning empty stats",
        { organizationId: input.organizationId, tenantId, windowSeconds, error },
      );
      return {
        windowSeconds,
        threshold,
        spanCount: 0,
        rate: 0,
        exceeded: false,
        perSource: [],
      };
    }
  }
}
