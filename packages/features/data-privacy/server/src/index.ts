export { PrismaDataPrivacyAdapter } from "./adapters/prisma.data-privacy.adapter.ts";
export {
  PrismaDataPrivacyResolutionAdapter,
  type DataPrivacyResolutionDatabase,
} from "./adapters/prisma.data-privacy-resolution.adapter.ts";
export { DataPrivacyProjectPort, DataPrivacyResolutionPort } from "./ports/data-privacy.port.ts";
export { DataPrivacyResolutionService } from "./services/data-privacy-resolution.service.ts";
export {
  DataPrivacyDirectoryPort,
  type DataPrivacyOrganizationDirectory,
  type DataPrivacyProjectLineage,
} from "./ports/data-privacy-directory.port.ts";
export { DataPrivacyPermissionsPort } from "./ports/data-privacy-permissions.port.ts";
export {
  PrismaDataPrivacyDirectoryRepository,
  type DataPrivacyDirectoryDatabase,
} from "./repositories/prisma/prisma.data-privacy-directory.repository.ts";
export {
  DataPrivacySnapshotService,
  type DataPrivacySnapshotPolicies,
} from "./services/data-privacy-snapshot.service.ts";
export { DataPrivacyScopeAuthorizationService } from "./services/data-privacy-scope-authorization.service.ts";
export { DataPrivacyService } from "./services/data-privacy.service.ts";
export {
  OtelPiiAnalysisMetricsAdapter,
  PII_ANALYSIS_DURATION_METRIC_NAME,
  PII_ANALYSIS_EVALUATOR_TYPE,
  PII_ANALYSIS_STATUS_METRIC_NAME,
  PII_CHECKS_METRIC_NAME,
} from "./adapters/otel.pii-analysis-metrics.adapter.ts";
export { PiiAnalysisMetricsPort, type PiiAnalysisOutcome } from "./ports/pii-analysis-metrics.port.ts";
export { type PIICheckOptions, PiiAnalysisPort } from "./ports/pii-analysis.port.ts";
export { ContentDropPolicyService } from "./services/content-drop-policy.service.ts";
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
export {
  DataPrivacyTrpcApi,
  type DataPrivacyTrpcContext,
  type DataPrivacyTrpcPorts,
} from "./transport/api-trpc/data-privacy.api.ts";

/** The in-memory policy source the ingestion collections drive their PII cases over. */
export { DataPrivacyServiceFake } from "./fixtures/data-privacy.fixture.ts";
