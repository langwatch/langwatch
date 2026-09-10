export { dataPrivacyServer } from "./data-privacy.server.ts";
export { dataPrivacyTrpcTransport } from "./transport/data-privacy.trpc.ts";
export type { DataPrivacyInfrastructure } from "./app/data-privacy.app.ts";
/**
 * The lineage a rule is placed and named against, and the analysis capability
 * the redaction calls out to. Both read stores this feature does not own, so
 * the process that owns them supplies them.
 */
export {
  DataPrivacyDirectoryRepository as DataPrivacyDirectoryPort,
  type DataPrivacyOrganizationDirectory,
  type DataPrivacyProjectLineage,
} from "./repositories/data-privacy-directory.repository.ts";
export { DataPrivacyProjectPort, DataPrivacyResolutionPort } from "./ports/data-privacy.port.ts";
export {
  PiiAnalysisMetricsPort,
  type PiiAnalysisOutcome,
} from "./ports/pii-analysis-metrics.port.ts";
export { type PIICheckOptions, PiiAnalysisPort } from "./ports/pii-analysis.port.ts";
export {
  PrismaDataPrivacyDirectoryRepository,
  type DataPrivacyDirectoryDatabase,
} from "./repositories/prisma/prisma.data-privacy-directory.repository.ts";
export {
  OtelPiiAnalysisMetricsAdapter,
  PII_ANALYSIS_DURATION_METRIC_NAME,
  PII_ANALYSIS_EVALUATOR_TYPE,
  PII_ANALYSIS_STATUS_METRIC_NAME,
  PII_CHECKS_METRIC_NAME,
} from "./adapters/otel.pii-analysis-metrics.adapter.ts";
/**
 * The ingestion halves the trace conversion composes directly, over a policy
 * source that resolves but does not write. They stay reachable until the trace
 * ports take a `DataPrivacyApi` instead.
 */
export { ContentDropPolicyService } from "./services/content-drop-policy.service.ts";
export { DataPrivacyResolutionService } from "./services/data-privacy-resolution.service.ts";
export {
  OtlpSpanContentDropService,
  type OtlpSpanContentDropServiceOptions,
  type SpanContentDropResult,
} from "./services/otlp-span-content-drop.service.ts";
export { OtlpSpanPiiRedactionService } from "./services/otlp-span-pii-redaction.service.ts";
export {
  type BatchClearPIIFunction,
  DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
  type OtlpSpanPiiRedactionServiceDependencies,
  PiiRedactionPolicyService,
} from "./services/pii-redaction-policy.service.ts";
