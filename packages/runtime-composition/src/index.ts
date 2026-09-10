export {
  ApplicationBuilder,
  BootedRuntime,
  createApp,
  type FeatureInstallOptions,
  type InstalledFeature,
  type RuntimeService,
} from "./application.ts";
export {
  DuplicateTransportNamespaceError,
  MissingTransportHostError,
  mountDeclaredTransports,
  type DeclaredTransports,
  type FeatureRestHost,
  type FeatureRestMountOptions,
  type FeatureTransportHosts,
  type FeatureTrpcHost,
  type FeatureTrpcMountOptions,
  type MountableTransport,
  type MountedTransports,
} from "./transport-mounting.ts";
export {
  DependencyCycleError,
  DuplicateFeatureError,
  DuplicateProviderError,
  FeatureConfigError,
  FeatureApiUnavailableError,
  MissingProviderError,
  RoleContributionError,
} from "./boot-errors.ts";
export {
  type DependencyToken,
  NO_TOKENS,
  type ResolvedTokens,
  type TokenMap,
  tokenName,
} from "./dependency-token.ts";
export {
  assertInfrastructure,
  MissingInfrastructureError,
  type MissingNeeds,
  type NeedsResult,
} from "./infrastructure-needs.ts";
export { moduleApi, ModuleApiToken } from "./module-api-token.ts";
export { LocalFeatureApis } from "./local-feature-api.ts";
export {
  type FeatureConfigSchema,
  type AppDefinition,
  type AppDefinitionWithoutConfig,
  defineModule,
  defineServerModule,
  type FeatureTransportDescriptor,
  type FeatureSetup,
  type FeatureInstallArguments,
  type FeatureProvider,
  type FeatureSetupArguments,
  type FeatureTransportArguments,
  type FeatureTransportSetupArguments,
  type FeatureWorkerArguments,
  type InstallableServerFeature,
  type InstalledFeatureState,
  serverFeature,
  ServerFeatureAssembly,
  ServerFeatureBuilder,
  type ServerFeatureDeclaration,
  type ServerRole,
} from "./feature-installer.ts";
export {
  FEATURE_NAMES,
  type ModuleName,
  type PublicNamespace,
  publicNamespace,
  publicNamespaceFromUnknown,
} from "./module-namespace.ts";
export {
  GracefulShutdown,
  type GracefulShutdownOptions,
  type ShutdownLogger,
  type ShutdownPhase,
  ShutdownPhaseTimeoutError,
  type ShutdownSignalHost,
} from "./graceful-shutdown.ts";
export { type ResourceCloser, type ResourceOwnership, ResourceScope } from "./resource-scope.ts";
export { RuntimeLifecycle, cleanupAfterFailure } from "./runtime-lifecycle.ts";

export {
  defineRepositories,
  instantiateRepositories,
  validateRepositorySelection,
  type PersistenceSelection,
  type RepositoryBackends,
  type RepositoryRegistry,
  type RepositoriesFor,
} from "./repository-registry.ts";

export {
  assertRepositoryOwnership,
  RepositoryOwnershipConflictError,
  type RepositoryTables,
  type RepositoryDeclaration,
  type FeatureRepositories,
} from "./repository-ownership.ts";
