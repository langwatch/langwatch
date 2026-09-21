import {
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  TEARDOWN_REQUESTED_EVENT_TYPE,
} from "@langwatch/identity";
import type { SsoConnectionGuards } from "@langwatch/identity-server";
import { definePipeline } from "../..";
import type { ProcessManagerInitialStage } from "../../pipeline/processBuilder";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
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
} from "./commands/ssoConnectionCommands";
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
} from "./process-manager/connectionTeardown.process";
import {
  SSO_CONNECTION_PROJECTION_NAME,
  type SsoConnectionFoldState,
  SsoConnectionStateFoldProjection,
} from "./projections/ssoConnectionState.foldProjection";
import {
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "./schemas/constants";
import type { SsoConnectionEvent } from "./schemas/events";

/**
 * Every verb the aggregate has, and the name its queue sender is resolved by
 * (the ledger writer maps a command type to one of these strings).
 *
 * A table rather than fourteen near-identical `.withCommandInstance(...)`
 * blocks: every one takes the same guards and differs only in its name and
 * class, so a list says that, and adding a verb is one line in one place
 * instead of five in two.
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
 * The SSO connection pipeline (D04, ADR-117 §5). One aggregate per
 * connection; the organization is the tenant. Commands append (waited) and
 * the operational projection folds into the Postgres `SsoConnection` head in
 * per-connection FIFO.
 *
 * Ships DARK: `SSOCONN_ROUTING` defaults to `off`, so nothing routes off this
 * projection and no string write stops. The grandfather migration is the only
 * production writer until D05's self-service, and it is paced by the same
 * per-organization enrollment every other in-place migration is.
 *
 * Lanes: the commands keep the default per-aggregate group key — one
 * connection is one lane, which is already the narrowest useful shard, and a
 * connection sees a handful of human actions in its lifetime so a lane never
 * has a batch to coalesce.
 */
export function createSsoConnectionPipeline(deps: SsoConnectionPipelineDeps) {
  let builder = definePipeline<SsoConnectionEvent>()
    .withName(SSO_CONNECTION_PIPELINE_NAME)
    .withAggregateType(SSO_CONNECTION_AGGREGATE_TYPE)
    .withProjection(
      SSO_CONNECTION_PROJECTION_NAME,
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

/**
 * The grace timer (ADR-117 §5): TEARDOWN_PENDING → TORN_DOWN happens through
 * this wake and nowhere else. The process holds only a deadline, and the
 * events it reads are ids and timestamps, so no content boundary is needed on
 * the payload.
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
