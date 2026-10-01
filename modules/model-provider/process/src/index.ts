export {
  PostgresModelProviderAdapter,
  type PostgresModelProviderAdapterOptions,
} from "./model-provider.module.ts";
export {
  PrismaModelCostCatalogRepository,
  type ModelCostCatalogDatabase,
} from "./model-provider.module.ts";
export type { ModelCostCatalogService } from "./services/model-cost-catalog.service.ts";
export type {
  CustomKeysRead,
  ModelProviderEgressRequest,
  ModelProviderEgressResponse,
} from "./app/model-provider.members.ts";
export { modelProviderConnectionPingChannels } from "./channels/model-provider-connection-ping-channels.registry.ts";
export type { ModelCostPreviewSpanReader } from "./services/model-cost-preview.service.ts";
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
