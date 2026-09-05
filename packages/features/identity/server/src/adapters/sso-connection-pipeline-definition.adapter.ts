import type { SsoConnectionGuards } from "../sso-connection-guards";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type ProcessManagerInitialStage,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  SSO_CONNECTION_EVENT_TYPES,
  TEARDOWN_REQUESTED_EVENT_TYPE,
} from "@langwatch/identity-contract";
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
} from "../intents/sso-connection.intent";
import {
  CONNECTION_TEARDOWN_INITIAL_STATE,
  CONNECTION_TEARDOWN_PROCESS_NAME,
  type ConnectionTeardownPort,
  type ConnectionTeardownState,
  completeTeardownIntentSchema,
  connectionTeardownWake,
  onTeardownRequested,
  onTornDown,
  runCompleteTeardown,
} from "../processes/connection-teardown.process";
import {
  type SsoConnectionEvent,
  type SsoConnectionFoldState,
  SsoConnectionStateFoldProjection,
} from "../projections/sso-connection-state.projection";
import {
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";

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
  /** The guards every command handler runs — `@langwatch/identity-server`'s
   *  SsoConnectionGuards over the app's projection reads, the same instance
   *  shape the calling path uses. */
  connectionGuards: SsoConnectionGuards;
  /** How the teardown wake dispatches its completion command. */
  teardown: ConnectionTeardownPort;
}

/**
 * connection; the organization is the tenant. Commands append (waited) and the operational
 * projection folds into the Postgres `SsoConnection` head in per-connection FIFO.
 * The SSO connection pipeline (D04, ADR-117 §5). One aggregate per
 */
export class SsoConnectionPipelineDefinitionAdapter {
  static create(deps: SsoConnectionPipelineDeps) {
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
  teardown: ConnectionTeardownPort,
) {
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
