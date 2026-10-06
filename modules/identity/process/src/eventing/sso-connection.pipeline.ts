import {
  defineAggregate,
  definePipeline,
  type IntentSpec,
  type ProcessManagerStage,
  type ProcessManagerInitialStage,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
  defineEventingModule,
  type EventingSetup,
} from "@langwatch/eventing";
import {
  MIGRATION_FINALIZED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import type { ZodType } from "zod";

import type { IdentityModule } from "../app/identity.app.ts";
import type { SsoDomainProofMail } from "../channels/sso-domain-proof-mail.channel.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import type { SsoBreakGlassBindingRepository } from "../repositories/sso-connection.repository.ts";
import type { SsoEngineProviderProjection } from "../repositories/sso-engine-provider.repository.ts";
import type { SsoConnectionDirectoryMoveService } from "../services/sso-connection-directory-move.service.ts";
import type { SsoConnectionGuardsDeps } from "../services/sso-connection-guard-checks.service.ts";
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
  connectionTeardownStateSchema,
  completeTeardownIntentSchema,
  connectionTeardownWake,
  onTeardownRequested,
  onTornDown,
} from "./connection-teardown.process.ts";
import type { IdentityEventing } from "./identity-command-senders.store.ts";
import { EngineFollowingSsoConnectionHeadStore } from "./sso-connection-head.store.ts";
import {
  type SsoConnectionEventAppends,
  SsoConnectionLedgerStore,
} from "./sso-connection-ledger.store.ts";
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
  connectionIdpUpdatedEventSchema,
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
  UpdateConnectionIdpCommand,
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
  ssoDomainProofNotificationStateSchema,
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
  "updateConnectionIdp",
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
  directoryMove: Pick<SsoConnectionDirectoryMoveService, "migrationFinalized">;
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
      connectionIdpUpdatedEventSchema,
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
    .withCommandInstance({
      name: "registerConnection",
      handlerClass: RegisterConnectionCommand,
      instance: new RegisterConnectionCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "claimDomain",
      handlerClass: ClaimDomainCommand,
      instance: new ClaimDomainCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "approveDomainClaim",
      handlerClass: ApproveDomainClaimCommand,
      instance: new ApproveDomainClaimCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "rejectDomainClaim",
      handlerClass: RejectDomainClaimCommand,
      instance: new RejectDomainClaimCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "discardConnection",
      handlerClass: DiscardConnectionCommand,
      instance: new DiscardConnectionCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "requestVerification",
      handlerClass: RequestVerificationCommand,
      instance: new RequestVerificationCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "attestDomain",
      handlerClass: AttestDomainCommand,
      instance: new AttestDomainCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "withdrawDomain",
      handlerClass: WithdrawDomainCommand,
      instance: new WithdrawDomainCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "verifyDomain",
      handlerClass: VerifyDomainCommand,
      instance: new VerifyDomainCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "activateConnection",
      handlerClass: ActivateConnectionCommand,
      instance: new ActivateConnectionCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "suspendConnection",
      handlerClass: SuspendConnectionCommand,
      instance: new SuspendConnectionCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "resumeConnection",
      handlerClass: ResumeConnectionCommand,
      instance: new ResumeConnectionCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "requestTeardown",
      handlerClass: RequestTeardownCommand,
      instance: new RequestTeardownCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "completeTeardown",
      handlerClass: CompleteTeardownCommand,
      instance: new CompleteTeardownCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "grandfatherConnection",
      handlerClass: GrandfatherConnectionCommand,
      instance: new GrandfatherConnectionCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "renameConnection",
      handlerClass: RenameConnectionCommand,
      instance: new RenameConnectionCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "updateConnectionIdp",
      handlerClass: UpdateConnectionIdpCommand,
      instance: new UpdateConnectionIdpCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "registerReplacementConnection",
      handlerClass: RegisterReplacementConnectionCommand,
      instance: new RegisterReplacementConnectionCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "selectMigrationRoute",
      handlerClass: SelectMigrationRouteCommand,
      instance: new SelectMigrationRouteCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "beginMigrationFinalization",
      handlerClass: BeginMigrationFinalizationCommand,
      instance: new BeginMigrationFinalizationCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "finalizeMigration",
      handlerClass: FinalizeMigrationCommand,
      instance: new FinalizeMigrationCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "setArrivalPolicy",
      handlerClass: SetArrivalPolicyCommand,
      instance: new SetArrivalPolicyCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "recordDomainProofAbsent",
      handlerClass: RecordDomainProofAbsentCommand,
      instance: new RecordDomainProofAbsentCommand(deps.connectionGuards),
    })
    .withCommandInstance({
      name: "recordDomainProofPresent",
      handlerClass: RecordDomainProofPresentCommand,
      instance: new RecordDomainProofPresentCommand(deps.connectionGuards),
    });

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
        await deps.directoryMove.migrationFinalized({
          organizationId: context.tenantId,
          connectionId: event.data.connectionId,
        });
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
): ProcessManagerStage<
  SsoConnectionEvent,
  ConnectionTeardownState,
  Record<string, IntentSpec<ZodType>>
> {
  return pm
    .state(connectionTeardownStateSchema, CONNECTION_TEARDOWN_INITIAL_STATE)
    .intent(
      "completeTeardown",
      completeTeardownIntentSchema,
      runCompleteTeardown({ port: teardown }),
    )
    .on(teardownRequestedEventSchema, onTeardownRequested)
    .on(connectionTornDownEventSchema, onTornDown)
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
): ProcessManagerStage<
  SsoConnectionEvent,
  SsoDomainProofNotificationState,
  Record<string, IntentSpec<ZodType>>
> {
  return pm
    .state(ssoDomainProofNotificationStateSchema, SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE)
    .intent(
      "notifyWavering",
      notifyProofWaveringIntentSchema,
      runNotifyProofWavering({ notifications }),
    )
    .intent("notifyLapsed", notifyProofLapsedIntentSchema, runNotifyProofLapsed({ notifications }))
    .on(domainProofWaveredEventSchema, onDomainProofWavered)
    .on(domainProofLapsedEventSchema, onDomainProofLapsed)
    .transient();
}

/** The connection graph a process commands through, and the pipeline built over the same one. */
export type SsoConnectionGraph = {
  connections: SsoConnectionService;
  guards: SsoConnectionGuardsService;
  /** Built only where the process drains the pipeline; the api constructs no reaction. */
  pipeline: () => SsoConnectionPipeline;
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
    | "ssoStranding"
    | "joinRequestAudience"
  >;
  /** The one "is there a way back in" answer, shared with the setup journey. */
  breakGlass: SsoBreakGlassBindingRepository;
  /** The sso_connection pipeline's own store. */
  eventStore: SsoConnectionEventAppends;
  /** The senders the process connected, which the ledger stages through. */
  commands: IdentityEventing;
  directoryMove: Pick<SsoConnectionDirectoryMoveService, "migrationFinalized">;
  directory?: SsoConnectionDirectoryRevocation;
  mail?: SsoDomainProofMail;
  engineProvider?: SsoEngineProviderProjection;
  /** What the installation's licence may decide, for the licence ceremony. */
  licensing: SsoConnectionGuardsDeps["licensing"];
  /** The platform-operator grant the operator-only acts are asked against. */
  authorization: SsoConnectionGuardsDeps["authorization"];
}): SsoConnectionGraph {
  const { repositories, eventStore, commands } = options;
  const head = EngineFollowingSsoConnectionHeadStore.create({
    heads: repositories.ssoConnectionHeads,
    engineProvider: options.engineProvider,
  });
  const guards = SsoConnectionGuardsService.create({
    connections: repositories.ssoConnections,
    registrationSlots: repositories.ssoRegistrationSlots,
    breakGlass: options.breakGlass,
    stranding: repositories.ssoStranding,
    authorization: options.authorization,
    licensing: options.licensing,
  });
  const connections = SsoConnectionService.create(
    guards,
    SsoConnectionLedgerStore.forPipeline({ projectionStore: head, eventStore, commands }),
  );
  const mail = options.mail;
  const pipeline = () =>
    defineSsoConnectionPipeline({
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
      directoryMove: options.directoryMove,
    });
  return { connections, guards, pipeline };
}

export const ssoConnectionEventing = defineEventingModule({
  pipeline: SSO_CONNECTION_PIPELINE_NAME,
  build: ({
    app,
    participation,
    eventStore,
  }: EventingSetup<IdentityRepositories, IdentityModule>) => {
    app.keepEventStore({ pipeline: SSO_CONNECTION_PIPELINE_NAME, participation, eventStore });
    return app.ssoConnectionPipeline();
  },
  connect: ({ app, commands }) =>
    app.connectPipeline({ pipeline: SSO_CONNECTION_PIPELINE_NAME, commands }),
});
