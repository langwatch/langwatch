import {
  OtelPiiAnalysisMetricsAdapter,
  OtlpSpanPiiRedactionService,
  type DataPrivacyResolutionPort,
  type PiiAnalysisMetricsPort,
  type PiiAnalysisPort,
} from "@langwatch/data-privacy-server";
import type { TenantId } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OtlpResource, OtlpSpan, PIIRedactionLevel } from "@langwatch/trace-contract";
import { TraceSpanPiiRedactionPort } from "@langwatch/trace-server";
import { WorkerPiiAnalysisAdapter } from "../platform/infrastructure/worker-pii-analysis.adapter";
import type { WorkerTracePrivacyConfig } from "../platform/config/worker.config";

/**
 * The PII redaction this process would scrub an incoming span with.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * `RecordSpanCommand`'s adapters and still redacts every span it ingests — so
 * nothing in this process redacts anything yet. What has to be true today is
 * that this composition root CAN build the whole path from what it already
 * holds: the four privacy variables it now reads, the scoped data-privacy
 * service, and the feature-flag service. That is the entire dependency list.
 *
 * The graph it builds, top to bottom:
 *
 *     TraceSpanPiiRedactionPort            (trace-server declares it)
 *       └─ OtlpSpanPiiRedactionService     (data-privacy-server owns it)
 *            ├─ DataPrivacyResolutionPort  resolves the scope's policy
 *            ├─ @langwatch/redaction       the native secrets + PII floor
 *            └─ PiiAnalysisPort            names + locations, out of process
 *                 └─ WorkerPiiAnalysisAdapter   Presidio, Google DLP fallback
 *
 * WHAT IS DELIBERATELY NOT HERE. The service's log and metric halves were not
 * harvested: `LogRedactionPort` and `MetricRedactionPort` belong to the log
 * and metric conversions, and the trace conversion reaches this graph through
 * `redact` alone. When those convert, they compose the same service and the
 * same transport rather than a second copy of either.
 */
export function createWorkerTracePrivacy(options: {
  config: WorkerTracePrivacyConfig;
  /**
   * Resolves the scope's policy.
   *
   * The port and not the whole `DataPrivacyService`, for the same reason the
   * content drop takes one: redaction reads a policy and never writes one, and
   * writing is what puts an `OrganizationService` behind the service.
   */
  dataPrivacy: DataPrivacyResolutionPort;
  featureFlags: FeatureFlagService;
  metrics?: PiiAnalysisMetricsPort;
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
 * The cumulative character budget one span's analysis batch may spend, as the
 * application passes it (`AppTracePrivacyRuntime.create`). It is a literal in
 * both graphs and not a variable in either: a process with a larger budget
 * sends attributes the other skipped, and a process with a smaller one marks
 * spans partially redacted that its twin scrubbed in full.
 */
export const WORKER_PII_REDACTION_MAX_ATTRIBUTE_LENGTH = 250_000;

/** One process-owned privacy graph, and the transport it has to give back. */
export class WorkerTracePrivacy {
  constructor(
    readonly transport: PiiAnalysisPort,
    readonly redaction: OtlpSpanPiiRedactionService,
  ) {}

  /** The narrow port `RecordSpanCommand` names, over this graph. */
  spanRedactionPort(): TraceSpanPiiRedactionPort {
    return new WorkerTraceSpanPiiRedactionAdapter(this.redaction);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

/**
 * Renames `redactSpan` onto the port Trace declares.
 *
 * Trace names four narrow ports on its record command and this answers one of
 * them; the redaction service is not a subclass of any of them, and it must
 * not become one — a service that extended one feature's port could not answer
 * the other two features' ports for the same policy.
 */
class WorkerTraceSpanPiiRedactionAdapter extends TraceSpanPiiRedactionPort {
  constructor(private readonly service: OtlpSpanPiiRedactionService) {
    super();
  }

  async redact(
    span: OtlpSpan,
    resource: OtlpResource | null,
    level: PIIRedactionLevel,
    tenantId: TenantId,
  ): Promise<void> {
    await this.service.redactSpan(span, resource, level, tenantId);
  }
}
