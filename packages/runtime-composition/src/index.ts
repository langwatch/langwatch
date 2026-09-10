export {
  ApplicationBuilder,
  type ApplicationOptions,
  BootedRuntime,
  createApp,
  type InstalledFeature,
  type RuntimeService,
  type TransportHostFactory,
  type TransportHostSource,
} from "./application.ts";
export {
  MissingTransportPeerError,
  transportPeersOf,
  type TransportPeers,
} from "./transport-peers.ts";
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
  type TransportFactBinding,
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
  buildClaimedMembers,
  membersFor,
  membersFrom,
  noMembers,
  MissingMemberError,
  type MemberClaim,
  type MemberSource,
} from "./module-members.ts";
export type { Tier } from "./tiers.ts";
export {
  commandsOf,
  eventingHostFrom,
  type EventingHost,
  type EventingParticipation,
  type FeatureEventing,
  type FeatureEventingRegistration,
  type FeatureEventingSetup,
} from "./module-eventing.ts";
export { moduleApi, ModuleApiToken } from "./module-api-token.ts";
export { LocalFeatureApis } from "./local-feature-api.ts";
export {
  type FeatureConfigSchema,
  type AppDefinition,
  type AppDefinitionWithoutConfig,
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
  type ModuleContributions,
  type ModuleTransportFacts,
  type ModuleTransportFactSetup,
  serverFeature,
  ServerFeatureAssembly,
  ServerFeatureBuilder,
  type ServerFeatureDeclaration,
  type ServerRole,
  withMemoryRepositories,
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
  repositoriesRequire,
  selectedRepositoryOwnership,
  validateRepositorySelection,
  type AnyRepositoryRegistry,
  type RepositoriesFor,
  type RepositoryRegistry,
  type RepositorySelection,
  type RepositoryTiers,
} from "./repository-registry.ts";

export {
  assertRepositoryOwnership,
  RepositoryOwnershipConflictError,
  type RepositoryTables,
  type RepositoryDeclaration,
  type FeatureRepositories,
} from "./repository-ownership.ts";
