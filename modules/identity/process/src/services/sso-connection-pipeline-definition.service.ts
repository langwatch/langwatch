import {
  defineAggregate,
  defineEvents,
  definePipeline,
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
  SSO_CONNECTION_EVENT_TYPES,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";

import { runCompleteTeardown } from "../eventing/connection-teardown.intent.ts";
import {
  CONNECTION_TEARDOWN_INITIAL_STATE,
  CONNECTION_TEARDOWN_PROCESS_NAME,
  type ConnectionTeardown,
  type ConnectionTeardownState,
  completeTeardownIntentSchema,
  connectionTeardownWake,
  onTeardownRequested,
  onTornDown,
} from "../eventing/connection-teardown.process.ts";
import {
  type SsoConnectionEvent,
  type SsoConnectionFoldState,
  SsoConnectionStateFoldProjection,
} from "../eventing/sso-connection-state.projection.ts";
import {
  ActivateConnectionCommand,
  ApproveDomainClaimCommand,
  AttestDomainCommand,
  ClaimDomainCommand,
  CompleteTeardownCommand,
  DiscardConnectionCommand,
  GrandfatherConnectionCommand,
  RegisterConnectionCommand,
  RejectDomainClaimCommand,
  RequestTeardownCommand,
  RequestVerificationCommand,
  ResumeConnectionCommand,
  SuspendConnectionCommand,
  VerifyDomainCommand,
} from "../eventing/sso-connection.intent.ts";
import {
  runNotifyProofLapsed,
  runNotifyProofWavering,
} from "../eventing/sso-domain-proof-notification.intent.ts";
import {
  notifyProofLapsedIntentSchema,
  notifyProofWaveringIntentSchema,
  onDomainProofLapsed,
  onDomainProofWavered,
  SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
  SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME,
  type SsoDomainProofNotifications,
  type SsoDomainProofNotificationState,
} from "../eventing/sso-domain-proof-notification.process.ts";
import type { SsoConnectionGuardsService } from "./sso-connection-guards.service.ts";

/**
 * Every verb the aggregate has, and the name its queue sender is resolved by (the ledger writer
 * maps a command type to one of these strings).
 */
const CONNECTION_COMMANDS = [
  ["registerConnection", RegisterConnectionCommand],
  ["claimDomain", ClaimDomainCommand],
  ["approveDomainClaim", ApproveDomainClaimCommand],
  ["rejectDomainClaim", RejectDomainClaimCommand],
  ["discardConnection", DiscardConnectionCommand],
  ["requestVerification", RequestVerificationCommand],
  ["attestDomain", AttestDomainCommand],
  ["verifyDomain", VerifyDomainCommand],
  ["activateConnection", ActivateConnectionCommand],
  ["suspendConnection", SuspendConnectionCommand],
  ["resumeConnection", ResumeConnectionCommand],
  ["requestTeardown", RequestTeardownCommand],
  ["completeTeardown", CompleteTeardownCommand],
  ["grandfatherConnection", GrandfatherConnectionCommand],
] as const;

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
}

/**
 * connection; the organization is the tenant. Commands append (waited) and the operational
 * projection folds into the Postgres `SsoConnection` head in per-connection FIFO.
 * The SSO connection pipeline (D04, ADR-117 §5). One aggregate per
 */
export class SsoConnectionPipelineDefinitionAdapter {
  static create(
    deps: SsoConnectionPipelineDeps,
  ): StaticPipelineDefinition<SsoConnectionEvent, Record<string, Projection>, RegisteredCommand> {
    let builder = definePipeline<SsoConnectionEvent>({
      name: SSO_CONNECTION_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: SSO_CONNECTION_AGGREGATE_TYPE,
        events: defineEvents(SSO_CONNECTION_EVENT_TYPES),
      }),
    }).withPostgresProjection(
      new SsoConnectionStateFoldProjection({
        store: deps.connectionProjectionStore,
      }),
    );

    for (const [name, Command] of CONNECTION_COMMANDS) {
      // The builder mutates and returns ITSELF; what narrows per call is only
      // its type, and what that type carries is the command-name registry —
      // which nothing downstream reads, because the ledger resolves senders by
      // string. So the loop holds one builder type and the table above stays
      // the readable list of verbs.
      builder = builder.withCommandInstance(
        name,
        Command,
        new Command(deps.connectionGuards),
      ) as typeof builder;
    }

    return builder
      .withProcessManager(CONNECTION_TEARDOWN_PROCESS_NAME, (pm) =>
        mountTeardownGrace(pm, deps.teardown),
      )
      .withProcessManager(SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME, (pm) =>
        mountDomainProofNotification(pm, deps.proofNotifications),
      )
      .build();
  }
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
  Record<string, IntentSpec<any>>
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
  Record<string, IntentSpec<any>>
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
