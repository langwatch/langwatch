export type { BootedRuntime } from "./application.ts";
export { composeApiApplication } from "./transport/api-surface.ts";
export { MissingTransportPeerError, transportPeersOf } from "./transport-peers.ts";
export {
  DuplicateTransportNamespaceError,
  MissingTransportHostError,
  mountDeclaredTransports,
  type DeclaredTransports,
  type FeatureTransportHosts,
  type FeatureWebSocketHost,
  type MountedTransports,
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
  buildClaimedMembers,
  membersFor,
  membersFrom,
  noMembers,
  storesBackedMembers,
  MissingMemberError,
  type MemberClaim,
  type MemberSource,
} from "./module-members.ts";
export type { Tier } from "./tiers.ts";
export {
  commandsOf,
  eventingHostFrom,
  type EventingHost,
  type FeatureEventingRegistration,
  readHintsOf,
  projectionReadsOf,
  ProjectionReadError,
  type ProjectionReadMap,
  type ProjectionReadTarget,
} from "./module-eventing.ts";
export { LocalFeatureApis } from "./local-feature-api.ts";
export {
  type AppDefinition,
  type AppDefinitionWithoutConfig,
  defineProcessModule,
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
  type ModuleTaskBinder,
  type ModuleTaskSetup,
  type ModuleTransportFacts,
  type ModuleTransportFactSetup,
  serverFeature,
  ServerFeatureAssembly,
  ServerFeatureBuilder,
  type ServerFeatureDeclaration,
  type ModuleOperatorReadsScope,
  type ModuleSecretsScope,
  type ServerRole,
  withMemoryRepositories,
} from "./feature-installer.ts";
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

export {
  GracefulShutdown,
  type GracefulShutdownOptions,
  type ShutdownLogger,
  type ShutdownPhase,
  ShutdownPhaseTimeoutError,
  type ShutdownSignalHost,
} from "./graceful-shutdown.ts";
export { Server } from "./server-factory.ts";
export { hostedRuntime } from "./hosted-runtime.ts";
export {
  type ApplicationHandler,
  type HealthRoute,
  type ServedApplication,
  type ServerComponent,
  type ServerContribution,
  type ServerLogger,
  type ServerOptions,
  type UpgradeDoor,
} from "./server.ts";
export { processOwner } from "./owner.ts";
export { observabilityOwner } from "./observability-owner.ts";
export { ServerPreamble, type Metrics, type PreambleOwner, type Telemetry } from "./preamble.ts";
export { ProcessServer } from "./process-server.ts";
export {
  ApiProcessContainer,
  type BootedApplication,
  TasksProcessContainer,
  WorkerProcessContainer,
  type ProcessBoot,
  type ProcessModule,
  isProcessModule,
} from "./process-container.ts";

export { processConfig } from "./config.ts";
