import type { ScimSsoMigrationSubscriberService } from "@langwatch/enterprise-scim-contract";
import {
  defineAggregate,
  definePipeline,
  type EventSourcing,
  type IntentSpec,
  type ProcessManagerHandledStage,
  type ProcessManagerInitialStage,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  MIGRATION_FINALIZED_EVENT_TYPE,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import type { ZodType } from "zod";

import type { SsoDomainProofMail } from "../app/identity.members.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { LocalDoorBreakGlassBindingRepository } from "../repositories/local/local.door-break-glass-binding.repository.ts";
import type { SsoEngineProviderProjection } from "../repositories/sso-engine-provider.repository.ts";
import { SsoBreakGlassRecoveryService } from "../services/sso-break-glass-recovery.service.ts";
import { RequiresLocalDoorAndBinding } from "../services/sso-break-glass.service.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import {
  SsoConnectionTeardownCompletionService,
  type SsoConnectionDirectoryRevocation,
  UnrevokedSsoConnectionDirectory,
} from "../services/sso-connection-teardown-completion.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import {
  SsoDomainProofNotificationService,
  UnaddressedSsoDomainProofNotifications,
} from "../services/sso-domain-proof-notification.service.ts";
import { runCompleteTeardown } from "./connection-teardown.intent.ts";
import {
  CONNECTION_TEARDOWN_INITIAL_STATE,
  CONNECTION_TEARDOWN_PROCESS_NAME,
  type ConnectionTeardown,
  type ConnectionTeardownState,
  completeTeardownIntentSchema,
  connectionTeardownWake,
  onTeardownRequested,
  onTornDown,
} from "./connection-teardown.process.ts";
import { EngineFollowingSsoConnectionHeadStore } from "./sso-connection-head.store.ts";
import { SsoConnectionLedgerStore } from "./sso-connection-ledger.store.ts";
import {
  type SsoConnectionEvent,
  type SsoConnectionFoldState,
  SsoConnectionStateFoldProjection,
  connectionRegisteredEventSchema,
  domainClaimedEventSchema,
  domainClaimApprovedEventSchema,
  domainClaimRejectedEventSchema,
  connectionDiscardedEventSchema,
  verificationRequestedEventSchema,
  domainAttestedEventSchema,
  domainWithdrawnEventSchema,
  domainVerifiedEventSchema,
  domainProofWaveredEventSchema,
  domainProofLapsedEventSchema,
  domainProofRecoveredEventSchema,
  connectionActivatedEventSchema,
  connectionSuspendedEventSchema,
  connectionResumedEventSchema,
  teardownRequestedEventSchema,
  connectionTornDownEventSchema,
  connectionArrivalPolicySetEventSchema,
  connectionRenamedEventSchema,
  replacementConnectionRegisteredEventSchema,
  migrationRouteSelectedEventSchema,
  migrationFinalizationStartedEventSchema,
  migrationFinalizedEventSchema,
} from "./sso-connection-state.projection.ts";
import {
  ActivateConnectionCommand,
  ApproveDomainClaimCommand,
  AttestDomainCommand,
  WithdrawDomainCommand,
  ClaimDomainCommand,
  CompleteTeardownCommand,
  DiscardConnectionCommand,
  GrandfatherConnectionCommand,
  RegisterConnectionCommand,
  RegisterReplacementConnectionCommand,
  RenameConnectionCommand,
  SelectMigrationRouteCommand,
  BeginMigrationFinalizationCommand,
  FinalizeMigrationCommand,
  RecordDomainProofAbsentCommand,
  RecordDomainProofPresentCommand,
  RejectDomainClaimCommand,
  RequestTeardownCommand,
  RequestVerificationCommand,
  ResumeConnectionCommand,
  SetArrivalPolicyCommand,
  SuspendConnectionCommand,
  VerifyDomainCommand,
} from "./sso-connection.intent.ts";
import {
  runNotifyProofLapsed,
  runNotifyProofWavering,
} from "./sso-domain-proof-notification.intent.ts";
import {
  notifyProofLapsedIntentSchema,
  notifyProofWaveringIntentSchema,
  onDomainProofLapsed,
  onDomainProofWavered,
  SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
  SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME,
  type SsoDomainProofNotifications,
  type SsoDomainProofNotificationState,
} from "./sso-domain-proof-notification.process.ts";

/**
 * Every verb the aggregate has, and the name its queue sender is resolved by (the ledger writer
 * maps a command type to one of these strings).
 */
const CONNECTION_COMMANDS = [
  "registerConnection",
  "claimDomain",
  "approveDomainClaim",
  "rejectDomainClaim",
  "discardConnection",
  "requestVerification",
  "attestDomain",
  "withdrawDomain",
  "verifyDomain",
  "activateConnection",
  "suspendConnection",
  "resumeConnection",
  "requestTeardown",
  "completeTeardown",
  "grandfatherConnection",
  "renameConnection",
  "registerReplacementConnection",
  "selectMigrationRoute",
  "beginMigrationFinalization",
  "finalizeMigration",
  "setArrivalPolicy",
  "recordDomainProofAbsent",
  "recordDomainProofPresent",
] as const;

/** The sender names the pipeline carries, which the ledger's own table must match. */
export const CONNECTION_COMMAND_NAMES: readonly string[] = CONNECTION_COMMANDS;

export interface SsoConnectionPipelineDeps {
  connectionProjectionStore: StateProjectionStore<SsoConnectionFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-process`'s
   *  SsoConnectionGuardsService over the app's projection reads, the same instance
   *  shape the calling path uses. */
  connectionGuards: SsoConnectionGuardsService;
  /** How the teardown wake dispatches its completion command. */
  teardown: ConnectionTeardown;
  /** Who is told when a verified domain's evidence goes missing (ADR-123). */
  proofNotifications: SsoDomainProofNotifications;
  /** Moves directory sync onto the replacement once a migration finishes. */
  directorySync: ScimSsoMigrationSubscriberService;
}

/**
 * connection; the organization is the tenant. Commands append (waited) and the operational
 * projection folds into the Postgres `SsoConnection` head in per-connection FIFO.
 * The SSO connection pipeline (D04, ADR-117 §5). One aggregate per
 */
export type SsoConnectionPipeline = StaticPipelineDefinition<
  SsoConnectionEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

export function defineSsoConnectionPipeline(
  deps: SsoConnectionPipelineDeps,
): SsoConnectionPipeline {
  const builder = definePipeline({
    name: SSO_CONNECTION_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: SSO_CONNECTION_AGGREGATE_TYPE,
    }),
  })
    .withEvents([
      connectionRegisteredEventSchema,
      domainClaimedEventSchema,
      domainClaimApprovedEventSchema,
      domainClaimRejectedEventSchema,
      connectionDiscardedEventSchema,
      verificationRequestedEventSchema,
      domainAttestedEventSchema,
      domainWithdrawnEventSchema,
      domainVerifiedEventSchema,
      domainProofWaveredEventSchema,
      domainProofLapsedEventSchema,
      domainProofRecoveredEventSchema,
      connectionActivatedEventSchema,
      connectionSuspendedEventSchema,
      connectionResumedEventSchema,
      teardownRequestedEventSchema,
      connectionTornDownEventSchema,
      connectionArrivalPolicySetEventSchema,
      connectionRenamedEventSchema,
      replacementConnectionRegisteredEventSchema,
      migrationRouteSelectedEventSchema,
      migrationFinalizationStartedEventSchema,
      migrationFinalizedEventSchema,
    ])
    .withPostgresProjection(
      new SsoConnectionStateFoldProjection({
        store: deps.connectionProjectionStore,
      }),
    )
    .withCommandInstance(
      "registerConnection",
      RegisterConnectionCommand,
      new RegisterConnectionCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "claimDomain",
      ClaimDomainCommand,
      new ClaimDomainCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "approveDomainClaim",
      ApproveDomainClaimCommand,
      new ApproveDomainClaimCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "rejectDomainClaim",
      RejectDomainClaimCommand,
      new RejectDomainClaimCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "discardConnection",
      DiscardConnectionCommand,
      new DiscardConnectionCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "requestVerification",
      RequestVerificationCommand,
      new RequestVerificationCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "attestDomain",
      AttestDomainCommand,
      new AttestDomainCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "withdrawDomain",
      WithdrawDomainCommand,
      new WithdrawDomainCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "verifyDomain",
      VerifyDomainCommand,
      new VerifyDomainCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "activateConnection",
      ActivateConnectionCommand,
      new ActivateConnectionCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "suspendConnection",
      SuspendConnectionCommand,
      new SuspendConnectionCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "resumeConnection",
      ResumeConnectionCommand,
      new ResumeConnectionCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "requestTeardown",
      RequestTeardownCommand,
      new RequestTeardownCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "completeTeardown",
      CompleteTeardownCommand,
      new CompleteTeardownCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "grandfatherConnection",
      GrandfatherConnectionCommand,
      new GrandfatherConnectionCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "renameConnection",
      RenameConnectionCommand,
      new RenameConnectionCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "registerReplacementConnection",
      RegisterReplacementConnectionCommand,
      new RegisterReplacementConnectionCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "selectMigrationRoute",
      SelectMigrationRouteCommand,
      new SelectMigrationRouteCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "beginMigrationFinalization",
      BeginMigrationFinalizationCommand,
      new BeginMigrationFinalizationCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "finalizeMigration",
      FinalizeMigrationCommand,
      new FinalizeMigrationCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "setArrivalPolicy",
      SetArrivalPolicyCommand,
      new SetArrivalPolicyCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "recordDomainProofAbsent",
      RecordDomainProofAbsentCommand,
      new RecordDomainProofAbsentCommand(deps.connectionGuards),
    )
    .withCommandInstance(
      "recordDomainProofPresent",
      RecordDomainProofPresentCommand,
      new RecordDomainProofPresentCommand(deps.connectionGuards),
    );

  return builder
    .withProcessManager(CONNECTION_TEARDOWN_PROCESS_NAME, (pm) =>
      mountTeardownGrace(pm, deps.teardown),
    )
    .withProcessManager(SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME, (pm) =>
      mountDomainProofNotification(pm, deps.proofNotifications),
    )
    .withEventSubscriber("scimDirectoryMove", {
      events: [MIGRATION_FINALIZED_EVENT_TYPE],
      handler: async (event, context) => {
        if (event.type !== MIGRATION_FINALIZED_EVENT_TYPE) return;
        await deps.directorySync.handleMigrationFinalized(
          { data: { connectionId: event.data.connectionId } },
          { tenantId: context.tenantId },
        );
      },
    })
    .build();
}

/**
 * this wake and nowhere else. The process holds only a deadline, and the events it reads are ids
 * and timestamps, so no content boundary is needed on the payload.
 * The grace timer (ADR-117 §5): TEARDOWN_PENDING → TORN_DOWN happens through
 */
function mountTeardownGrace(
  pm: ProcessManagerInitialStage<SsoConnectionEvent>,
  teardown: ConnectionTeardown,
): ProcessManagerHandledStage<
  SsoConnectionEvent,
  ConnectionTeardownState,
  Record<string, IntentSpec<ZodType>>
> {
  return pm
    .state<ConnectionTeardownState>(CONNECTION_TEARDOWN_INITIAL_STATE)
    .intent(
      "completeTeardown",
      completeTeardownIntentSchema,
      runCompleteTeardown({ port: teardown }),
    )
    .on(TEARDOWN_REQUESTED_EVENT_TYPE, onTeardownRequested)
    .on(CONNECTION_TORN_DOWN_EVENT_TYPE, onTornDown)
    .onWake(connectionTeardownWake);
}

/**
 * The two notices a missing proof sends (ADR-123). Transient: each fact
 * carries everything its mail needs, so nothing is remembered and no wake is
 * armed — one mail per ceremony, keyed so a redelivery is the same mail.
 */
function mountDomainProofNotification(
  pm: ProcessManagerInitialStage<SsoConnectionEvent>,
  notifications: SsoDomainProofNotifications,
): ProcessManagerHandledStage<
  SsoConnectionEvent,
  SsoDomainProofNotificationState,
  Record<string, IntentSpec<ZodType>>
> {
  return pm
    .state<SsoDomainProofNotificationState>(SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE)
    .intent(
      "notifyWavering",
      notifyProofWaveringIntentSchema,
      runNotifyProofWavering({ notifications }),
    )
    .intent("notifyLapsed", notifyProofLapsedIntentSchema, runNotifyProofLapsed({ notifications }))
    .on(DOMAIN_PROOF_WAVERED_EVENT_TYPE, onDomainProofWavered)
    .on(DOMAIN_PROOF_LAPSED_EVENT_TYPE, onDomainProofLapsed)
    .transient();
}

/** The connection graph a process commands through, and the pipeline built over the same one. */
export type SsoConnectionGraph = {
  connections: SsoConnectionService;
  pipeline: SsoConnectionPipeline;
};

/**
 * The ONLY graph that can advance TEARDOWN_PENDING to TORN_DOWN (D04, ADR-117 §5). One
 * `connections` instance serves both the back office and the teardown subscriber.
 */
export function composeSsoConnectionGraph(options: {
  repositories: Pick<
    IdentityRepositories,
    | "ssoConnectionHeads"
    | "ssoConnections"
    | "ssoRegistrationSlots"
    | "ssoBreakGlass"
    | "ssoStranding"
    | "ssoPlatformOperators"
    | "joinRequestAudience"
  >;
  eventSourcing: EventSourcing;
  directorySync: ScimSsoMigrationSubscriberService;
  directory?: SsoConnectionDirectoryRevocation;
  mail?: SsoDomainProofMail;
  engineProvider?: SsoEngineProviderProjection;
}): SsoConnectionGraph {
  const { repositories, eventSourcing } = options;
  const head = EngineFollowingSsoConnectionHeadStore.create({
    heads: repositories.ssoConnectionHeads,
    engineProvider: options.engineProvider,
  });
  const guards = SsoConnectionGuardsService.create({
    connections: repositories.ssoConnections,
    registrationSlots: repositories.ssoRegistrationSlots,
    breakGlass: RequiresLocalDoorAndBinding.create({
      localDoor: LocalDoorBreakGlassBindingRepository.create(),
      bindings: SsoBreakGlassRecoveryService.create({ bindings: repositories.ssoBreakGlass }),
    }),
    stranding: repositories.ssoStranding,
    platformOperators: repositories.ssoPlatformOperators,
  });
  const connections = SsoConnectionService.create(
    guards,
    SsoConnectionLedgerStore.forEventSourcing({ projectionStore: head, eventSourcing }),
  );
  const mail = options.mail;
  const pipeline = defineSsoConnectionPipeline({
    connectionProjectionStore: head,
    connectionGuards: guards,
    teardown: SsoConnectionTeardownCompletionService.create({
      connections: () => connections,
      directory: options.directory ?? UnrevokedSsoConnectionDirectory.create(),
    }),
    proofNotifications: mail
      ? SsoDomainProofNotificationService.create({
          audience: repositories.joinRequestAudience,
          mail,
        })
      : UnaddressedSsoDomainProofNotifications.create(),
    directorySync: options.directorySync,
  });
  return { connections, pipeline };
}
