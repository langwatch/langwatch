import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  type QuarantineFillInput,
  type QuarantineFillStats,
} from "@langwatch/enterprise-governance-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import type {
  GovernanceDiagnosticsSink,
  QuarantineTenantResolver,
} from "../app/governance.members.ts";
import { NullGovernanceDiagnosticsAdapter } from "./governance-diagnostics.service.ts";

export class QuarantineFillEvaluatorService {
  private readonly tenant: QuarantineTenantResolver;
  private readonly traces: Pick<TraceApi, "findTraceCountsByAttribute">;
  private readonly diagnostics: GovernanceDiagnosticsSink;
  private readonly now: () => number;

  private constructor({
    tenant,
    traces,
    diagnostics,
    now,
  }: {
    tenant: QuarantineTenantResolver;
    traces: Pick<TraceApi, "findTraceCountsByAttribute">;
    diagnostics: GovernanceDiagnosticsSink;
    now: () => number;
  }) {
    this.tenant = tenant;
    this.traces = traces;
    this.diagnostics = diagnostics;
    this.now = now;
  }

  static create(options: {
    tenant: QuarantineTenantResolver;
    traces: Pick<TraceApi, "findTraceCountsByAttribute">;
    diagnostics?: GovernanceDiagnosticsSink;
    now?: () => number;
  }): QuarantineFillEvaluatorService {
    return new QuarantineFillEvaluatorService({
      tenant: options.tenant,
      traces: options.traces,
      diagnostics: options.diagnostics ?? new NullGovernanceDiagnosticsAdapter(),
      now: options.now ?? Date.now,
    });
  }

  async evaluate(input: QuarantineFillInput): Promise<QuarantineFillStats> {
    const windowSeconds = input.windowSeconds ?? QUARANTINE_DEFAULT_WINDOW_SECONDS;
    const threshold = input.threshold ?? QUARANTINE_DEFAULT_THRESHOLD;
    const tenantId = await this.tenant.resolveTenantId(input.organizationId);

    try {
      const rows = await this.traces.findTraceCountsByAttribute({
        projectId: tenantId,
        sinceMs: this.now() - windowSeconds * 1_000,
        attribute: { key: GOVERNANCE_ATTR.ORIGIN_KIND, value: GOVERNANCE_ORIGIN_KIND_VALUE },
        groupByKey: GOVERNANCE_ATTR.INGESTION_SOURCE_ID,
      });
      const perSource = rows
        .filter(({ value }) => value.length > 0)
        .map(({ value, count }) => ({
          ingestionSourceId: value,
          spanCount: count,
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
