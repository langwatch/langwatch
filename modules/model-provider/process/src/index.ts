export {
  PostgresModelProviderAdapter,
  type PostgresModelProviderAdapterOptions,
} from "./model-provider.module.ts";
export {
  PrismaModelCostCatalogRepository,
  type ModelCostCatalogDatabase,
} from "./model-provider.module.ts";
export type { ModelCostCatalogService } from "./services/model-cost-catalog.service.ts";
export {
  ModelCostProject,
  ModelCostProjectScope,
  ModelProviderCatalog,
  ModelProviderCodexHandle,
  ModelProviderCredentialCipher,
  ModelProviderCredentialCodec,
  ModelProviderCredentialPolicy,
  ModelProviderCredentialProbe,
  ModelProviderConnectionRateLimiter,
  ModelProviderEgress,
  ModelProviderManagedGateway,
  ModelProviderRateLimit,
  CodexTokenRefresher,
  ModelTranslation,
  ModelProviderIdService,
} from "./app/model-provider.members.ts";
export type {
  CustomKeysRead,
  ModelProviderEgressRequest,
  ModelProviderEgressResponse,
} from "./app/model-provider.members.ts";
export { PrismaModelProviderCredentialMapper } from "./repositories/prisma/prisma.model-provider-credential.mapper.ts";
export {
  RegistryModelProviderCatalogService,
  type RegistryModelProviderCatalogOptions,
} from "./services/registry-model-provider-catalog.service.ts";
export { modelProviderConnectionPingChannels } from "./channels/model-provider-connection-ping-channels.registry.ts";
export { UnmanagedModelProviderGatewayService } from "./services/unmanaged-model-provider-gateway.service.ts";
export { HttpModelProviderCredentialProbeService } from "./services/http-model-provider-credential-probe.service.ts";
export { UnavailableModelProviderCredentialProbeService } from "./services/unavailable-model-provider-credential-probe.service.ts";
export {
  CodexAccountService,
  type CodexDeviceCode,
  type CodexPollResult,
} from "./services/codex-account.service.ts";
export { CodexOAuthModelProviderTokenRefresherService } from "./services/codex-oauth-model-provider-token-refresher.service.ts";
export { AiCallFailureService } from "./services/ai-call-failure.service.ts";
export type { ModelCostPreviewSpanReader } from "./services/model-cost-preview.service.ts";
export { WindowedModelProviderConnectionRateLimiterService } from "./services/windowed-model-provider-connection-rate-limiter.service.ts";
export {
  SsrfModelProviderEgressService,
  type ModelProviderEgressPolicy,
} from "./services/ssrf-model-provider-egress.service.ts";
export { PrefixedModelProviderIdService } from "./services/prefixed-model-provider-id.service.ts";
export { VercelAiModelTranslationService } from "./services/vercel-ai-model-translation.service.ts";
export {
  ModelProviderExecutionHandleService,
  type ModelProviderExecutionHandleInput,
  type ModelProviderExecutionHandleOptions,
} from "./services/model-provider-execution-handle.service.ts";
export { pickMaxTokensCeiling } from "./rules/max-tokens-ceiling.rules.ts";
export {
  getModelMetadataForFrontend,
  getProjectModelProviders,
  type LegacyModelProviderExecution,
  mergeCustomModelMetadata,
  prepareEnvKeys,
  prepareLitellmParams,
  toLegacyExecutionProvider,
  toLegacyProviderSummary,
} from "./rules/legacy-model-provider.rules.ts";
export type {
  ModelProviderCaller,
  ModelProviderCodexDeviceFlow,
  ModelProviderIdFactory,
  ModelProviderInfrastructure,
  SpanReader,
} from "./app/model-provider.app.ts";
export { modelProviderProcessModule } from "./model-provider.module.ts";

// --------------------------------------------------------------------------- Model Provider's
// composition seam: how a process composes the gateway from its own substrates, without naming
// one of the module's adapters, services or repositories.
// ---------------------------------------------------------------------------
export {
  createModelProviderCodexDeviceFlow,
  createModelProviderCostCatalog,
  createModelProviderRuntime,
  readModelProviderCustomKeys,
  resolveModelProviderExecutionHandle,
  type ModelProviderExecutionHandle,
  type ModelProviderExecutionHandleRequest,
  type ModelProviderRuntime,
  type ModelProviderRuntimeInput,
  type ModelProviderTranslationSurface,
} from "./model-provider.module.ts";
export { modelProviderRest } from "./transport/model-provider.rest.ts";
export { modelDefaultsRest, modelDefaultsRestCredential } from "./transport/model-defaults.rest.ts";
export { playgroundRest } from "./transport/playground.rest.ts";
export { modelProviderTrpcTransport } from "./transport/model-provider.trpc.ts";
export { llmModelCostTrpcTransport } from "./transport/llm-model-cost.trpc.ts";
export { translateTrpcTransport } from "./transport/translate.trpc.ts";

export { ModelProviderCredentialsMigrateTask } from "./tasks/model-provider-credentials-migrate.task.ts";
export { ModelProviderCustomModelsMigrateTask } from "./tasks/model-provider-custom-models-migrate.task.ts";
export type {
  ModelProviderMigrationDatabase,
  ModelProviderMigrationOutcome,
} from "./rules/model-provider-migration.rules.ts";
export {
  ModelRegistrySyncTask,
  syncModelRegistry,
  type ModelRegistrySyncResult,
} from "./tasks/model-registry-sync.task.ts";
