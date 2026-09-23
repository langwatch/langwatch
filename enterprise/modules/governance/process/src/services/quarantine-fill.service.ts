import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  type QuarantineFillInput,
  type QuarantineFillStats,
} from "@langwatch/enterprise-governance-contract";

import type {
  GovernanceDiagnosticsSink,
  QuarantineTenantResolver,
  QuarantineTraceActivityReader,
} from "../app/governance.members.ts";
import { NullGovernanceDiagnosticsAdapter } from "./governance-diagnostics.service.ts";

export class QuarantineFillEvaluatorService {
  private readonly tenant: QuarantineTenantResolver;
  private readonly traceActivity: QuarantineTraceActivityReader | undefined;
  private readonly diagnostics: GovernanceDiagnosticsSink;
  private readonly now: () => number;

  private constructor({
    tenant,
    traceActivity,
    diagnostics,
    now,
  }: {
    tenant: QuarantineTenantResolver;
    traceActivity: QuarantineTraceActivityReader | undefined;
    diagnostics: GovernanceDiagnosticsSink;
    now: () => number;
  }) {
    this.tenant = tenant;
    this.traceActivity = traceActivity;
    this.diagnostics = diagnostics;
    this.now = now;
  }

  static create(options: {
    tenant: QuarantineTenantResolver;
    traceActivity?: QuarantineTraceActivityReader;
    diagnostics?: GovernanceDiagnosticsSink;
    now?: () => number;
  }): QuarantineFillEvaluatorService {
    return new QuarantineFillEvaluatorService({
      tenant: options.tenant,
      traceActivity: options.traceActivity,
      diagnostics: options.diagnostics ?? new NullGovernanceDiagnosticsAdapter(),
      now: options.now ?? Date.now,
    });
  }

  async evaluate(input: QuarantineFillInput): Promise<QuarantineFillStats> {
    const windowSeconds = input.windowSeconds ?? QUARANTINE_DEFAULT_WINDOW_SECONDS;
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
      const spanCount = perSource.reduce((total, source) => total + source.spanCount, 0);
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
      this.diagnostics.warn("quarantine fill evaluation failed — returning empty stats", {
        organizationId: input.organizationId,
        tenantId,
        windowSeconds,
        error,
      });

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
