export { PrismaDataPrivacyAdapter } from "./adapters/prisma.data-privacy.adapter";
export {
  PrismaDataPrivacyResolutionAdapter,
  type DataPrivacyResolutionDatabase,
} from "./adapters/prisma.data-privacy-resolution.adapter";
export { DataPrivacyProjectPort, DataPrivacyResolutionPort } from "./ports/data-privacy.port";
export { DataPrivacyResolutionService } from "./services/data-privacy-resolution.service";
export {
  DataPrivacyDirectoryPort,
  type DataPrivacyOrganizationDirectory,
  type DataPrivacyProjectLineage,
} from "./ports/data-privacy-directory.port";
export { DataPrivacyPermissionsPort } from "./ports/data-privacy-permissions.port";
export {
  PrismaDataPrivacyDirectoryRepository,
  type DataPrivacyDirectoryDatabase,
} from "./repositories/prisma/prisma.data-privacy-directory.repository";
export {
  DataPrivacySnapshotService,
  type DataPrivacySnapshotPolicies,
} from "./services/data-privacy-snapshot.service";
export {
  DataPrivacyScopeAuthorizationService,
  requiredDataPrivacyWritePermission,
} from "./services/data-privacy-scope-authorization.service";
export { DataPrivacyService } from "./services/data-privacy.service";
export {
  OtelPiiAnalysisMetricsAdapter,
  PII_ANALYSIS_DURATION_METRIC_NAME,
  PII_ANALYSIS_EVALUATOR_TYPE,
  PII_ANALYSIS_STATUS_METRIC_NAME,
  PII_CHECKS_METRIC_NAME,
} from "./adapters/otel.pii-analysis-metrics.adapter";
export { PiiAnalysisMetricsPort, type PiiAnalysisOutcome } from "./ports/pii-analysis-metrics.port";
export { type PIICheckOptions, PiiAnalysisPort } from "./ports/pii-analysis.port";
export { ContentDropPolicyService } from "./services/content-drop-policy.service";
export {
  OtlpSpanContentDropService,
  type OtlpSpanContentDropServiceOptions,
  type SpanContentDropResult,
} from "./services/otlp-span-content-drop.service";
export { OtlpSpanPiiRedactionService } from "./services/otlp-span-pii-redaction.service";
export {
  type BatchClearPIIFunction,
  DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
  type OtlpSpanPiiRedactionServiceDependencies,
  PiiRedactionPolicyService,
} from "./services/pii-redaction-policy.service";
export {
  DataPrivacyTrpcApi,
  type DataPrivacyTrpcContext,
  type DataPrivacyTrpcPorts,
} from "./transport/api-trpc/data-privacy.api";

/** The in-memory policy source the ingestion collections drive their PII cases over. */
export { DataPrivacyServiceFake } from "./fixtures/data-privacy.fixture";
