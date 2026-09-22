export type { BootedRuntime } from "./application.ts";
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
  FeatureApiUnavailableError,
  FeatureSecretsUnavailableError,
  MissingProviderError,
  RoleContributionError,
} from "./boot-errors.ts";
export {
  type DependencyToken,
  NO_TOKENS,
  type ResolvedTokens,
  type TokenIdentity,
  type TokenMap,
  tokenName,
} from "./dependency-token.ts";
export {
  buildClaimedMembers,
  membersFor,
  membersFrom,
  noMembers,
  storesBackedMembers,
  MissingMemberError,
  type MemberClaim,
  type MemberSource,
  type StoresMemberSource,
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
export { moduleApi, ModuleApiToken, type OperationsOnly } from "./module-api-token.ts";
export { supplyToken, SupplyToken } from "./supply-token.ts";
export { LocalFeatureApis } from "./local-feature-api.ts";
export {
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
  type ModuleSecretsScope,
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

export { createApp, ProcessSupply, type ExposedSurface } from "./process-supply.ts";
export { ObservabilitySupply } from "./process-supply.options.ts";
export type { RequiredConfig, RequiredMembers, RequiredPeers } from "./process-supply.types.ts";
export { bootInstalledProcess } from "./boot-installed-process.ts";
