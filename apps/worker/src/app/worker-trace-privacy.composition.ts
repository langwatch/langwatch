import {
  OtelPiiAnalysisMetricsAdapter,
  OtlpSpanPiiRedactionService,
  type DataPrivacyResolution,
  type PiiAnalysisMetrics,
  type PiiAnalysis,
} from "@langwatch/data-privacy-server";
import type { TenantId } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OtlpResource, OtlpSpan, PIIRedactionLevel } from "@langwatch/trace-contract";
import { type TraceSpanPiiRedaction } from "@langwatch/trace-server";
import { WorkerPiiAnalysisAdapter } from "../platform/infrastructure/worker-pii-analysis.adapter.ts";
import type { WorkerTracePrivacyConfig } from "../platform/config/worker.config.ts";

/**
 * Staged but not mounted; builds the PII redaction from config, data-privacy,
 * and Presidio.
 */
export function createWorkerTracePrivacy(options: {
  config: WorkerTracePrivacyConfig;
  /**
   * Resolves the scope's policy: the port, not the whole `DataPrivacyService`,
   * because redaction reads a policy and never writes one, and writing is
   * what puts an `OrganizationService` behind the service.
   */
  dataPrivacy: DataPrivacyResolution;
  featureFlags: FeatureFlagApi;
  metrics?: PiiAnalysisMetrics;
}): WorkerTracePrivacy {
  const transport = WorkerPiiAnalysisAdapter.create({
    config: options.config,
    metrics: options.metrics ?? OtelPiiAnalysisMetricsAdapter.create(),
  });
  const redaction = OtlpSpanPiiRedactionService.create({
    transport,
    isLangevalsConfigured: Boolean(options.config.presidio.endpoint),
    isProduction: options.config.isProduction,
    nativePolicyEnforced: options.config.nativePolicyEnforced,
    piiRedactionMaxAttributeLength: WORKER_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
    dataPrivacy: options.dataPrivacy,
    featureFlags: options.featureFlags,
  });
  return new WorkerTracePrivacy(transport, redaction);
}

/**
 * The cumulative character budget one span's analysis batch may spend, as
 * `AppTracePrivacyRuntime.create` passes it. A literal in both graphs, not a
 * variable — a mismatch redacts one twin's spans more or less than the other.
 */
export const WORKER_PII_REDACTION_MAX_ATTRIBUTE_LENGTH = 250_000;

/** One process-owned privacy graph, and the transport it has to give back. */
export class WorkerTracePrivacy {
  constructor(
    readonly transport: PiiAnalysis,
    readonly redaction: OtlpSpanPiiRedactionService,
  ) {}

  /** The narrow port `EventingRecordSpanAdapter` names, over this graph. */
  spanRedactionPort(): TraceSpanPiiRedaction {
    return new WorkerTraceSpanPiiRedactionAdapter(this.redaction);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

/**
 * Renames `redactSpan` onto the port Trace declares. Trace names four narrow
 * ports on its record command and this answers one; the redaction service
 * must NOT subclass any of them, or it couldn't answer the other two as well.
 */
class WorkerTraceSpanPiiRedactionAdapter implements TraceSpanPiiRedaction {
  constructor(private readonly service: OtlpSpanPiiRedactionService) {}

  async redact(
    span: OtlpSpan,
    resource: OtlpResource | null,
    level: PIIRedactionLevel,
    tenantId: TenantId,
  ): Promise<void> {
    await this.service.redactSpan(span, resource, level, tenantId);
  }
}
