import type { JoinRequestGuards } from "../join-request-guards";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type ProcessManagerInitialStage,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_EXPIRED_EVENT_TYPE,
  JOIN_REJECTED_EVENT_TYPE,
  JOIN_REQUEST_EVENT_TYPES,
  JOIN_REQUESTED_EVENT_TYPE,
  JOIN_WITHDRAWN_EVENT_TYPE,
} from "@langwatch/identity-contract";
import {
  ApproveJoinCommand,
  ExpireJoinCommand,
  RejectJoinCommand,
  RequestJoinCommand,
  WithdrawJoinCommand,
} from "../intents/join-request.intent";
import {
  expireRequestIntentSchema,
  JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
  JOIN_REQUEST_LIFECYCLE_PROCESS_NAME,
  type JoinRequestLifecyclePort,
  type JoinRequestLifecycleState,
  joinRequestLifecycleWake,
  onJoinRequested,
  onJoinResolved,
  remindAdminsIntentSchema,
  runExpireRequest,
  runRemindAdmins,
} from "../processes/join-request-lifecycle.process";
import {
  type JoinRequestEvent,
  type JoinRequestFoldState,
  JoinRequestStateFoldProjection,
} from "../projections/join-request-state.projection";
import {
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_PIPELINE_NAME,
} from "@langwatch/identity-contract";

/**
 * Every verb the aggregate has, and the name its queue sender is resolved by (the ledger writer
 * maps a command type to one of these strings).
 */
const JOIN_REQUEST_COMMANDS = [
  ["requestJoin", RequestJoinCommand],
  ["approveJoin", ApproveJoinCommand],
  ["rejectJoin", RejectJoinCommand],
  ["withdrawJoin", WithdrawJoinCommand],
  ["expireJoin", ExpireJoinCommand],
] as const;

export interface JoinRequestPipelineDeps {
  joinRequestProjectionStore: StateProjectionStore<JoinRequestFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-server`'s
   *  JoinRequestGuards over the app's projection reads, the same instance
   *  shape the calling path uses. */
  joinRequestGuards: JoinRequestGuards;
  /** How the reminder and expiry wakes reach the world. */
  lifecycle: JoinRequestLifecyclePort;
}

export type JoinRequestPipeline = ReturnType<typeof JoinRequestPipelineDefinitionAdapter.create>;

/**
 * organization is the tenant. Commands append (waited) and the operational projection folds into
 * the Postgres `JoinRequest` head in per-request FIFO.
 * The join-request pipeline (D12, ADR-117). One aggregate per request; the
 */
export class JoinRequestPipelineDefinitionAdapter {
  static create(deps: JoinRequestPipelineDeps) {
    let builder = definePipeline<JoinRequestEvent>({
      name: JOIN_REQUEST_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: JOIN_REQUEST_AGGREGATE_TYPE,
        events: defineEvents(JOIN_REQUEST_EVENT_TYPES),
      }),
    }).withPostgresProjection(
      new JoinRequestStateFoldProjection({
        store: deps.joinRequestProjectionStore,
      }),
    );

    for (const [name, Command] of JOIN_REQUEST_COMMANDS) {
      // The builder mutates and returns ITSELF; what narrows per call is only
      // its type, and what that type carries is the command-name registry —
      // which nothing downstream reads, because the ledger resolves senders by
      // string. So the loop holds one builder type and the table above stays
      // the readable list of verbs.
      builder = builder.withCommandInstance(
        name,
        Command,
        new Command(deps.joinRequestGuards),
      ) as typeof builder;
    }

    return builder
      .withProcessManager(JOIN_REQUEST_LIFECYCLE_PROCESS_NAME, (pm) =>
        mountRequestLifecycle(pm, deps.lifecycle),
      )
      .build();
  }
}

/**
 * The two timers (D12): the day-7 reminder and the day-14 expiry, on ONE wake column. PENDING →
 * EXPIRED happens through this wake and nowhere else, and the reminder is the only nudge admins
 * ever get about a given request.
 */
function mountRequestLifecycle(
  pm: ProcessManagerInitialStage<JoinRequestEvent>,
  lifecycle: JoinRequestLifecyclePort,
) {
  return pm
    .state<JoinRequestLifecycleState>(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE)
    .intent("remindAdmins", remindAdminsIntentSchema, runRemindAdmins({ port: lifecycle }))
    .intent("expireRequest", expireRequestIntentSchema, runExpireRequest({ port: lifecycle }))
    .on(JOIN_REQUESTED_EVENT_TYPE, onJoinRequested)
    .on(JOIN_APPROVED_EVENT_TYPE, onJoinResolved)
    .on(JOIN_REJECTED_EVENT_TYPE, onJoinResolved)
    .on(JOIN_WITHDRAWN_EVENT_TYPE, onJoinResolved)
    .on(JOIN_EXPIRED_EVENT_TYPE, onJoinResolved)
    .onWake(joinRequestLifecycleWake);
}
