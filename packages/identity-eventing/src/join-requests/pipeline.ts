import {
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_EXPIRED_EVENT_TYPE,
  JOIN_REJECTED_EVENT_TYPE,
  JOIN_REQUESTED_EVENT_TYPE,
  JOIN_WITHDRAWN_EVENT_TYPE,
} from "@langwatch/identity";
import type { JoinRequestGuards } from "@langwatch/identity-server";
import {
  definePipeline,
  type ProcessManagerInitialStage,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  ApproveJoinCommand,
  ExpireJoinCommand,
  RejectJoinCommand,
  RequestJoinCommand,
  WithdrawJoinCommand,
} from "./commands/joinRequestCommands";
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
} from "./process-manager/joinRequestLifecycle.process";
import {
  JOIN_REQUEST_PROJECTION_NAME,
  type JoinRequestFoldState,
  JoinRequestStateFoldProjection,
} from "./projections/joinRequestState.foldProjection";
import {
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_PIPELINE_NAME,
} from "./schemas/constants";
import type { JoinRequestEvent } from "./schemas/events";

/**
 * Every verb the aggregate has, and the name its queue sender is resolved by
 * (the ledger writer maps a command type to one of these strings).
 *
 * A table rather than five near-identical `.withCommandInstance(...)` blocks:
 * every one takes the same guards and differs only in its name and class.
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

/**
 * The join-request pipeline (D12, ADR-117). One aggregate per request; the
 * organization is the tenant. Commands append (waited) and the operational
 * projection folds into the Postgres `JoinRequest` head in per-request FIFO.
 *
 * Ships DARK: `JOIN_REQUESTS` defaults off, so nothing dispatches these
 * commands, no interstitial renders and no panel appears — a deploy changes
 * nothing on its own, and rollback is the flag.
 *
 * Lanes: the commands keep the default per-aggregate group key — one request
 * is one lane, which is already the narrowest useful shard, and a request
 * sees a handful of human actions in its life so a lane never has a batch to
 * coalesce.
 */
export function createJoinRequestPipeline(deps: JoinRequestPipelineDeps) {
  let builder = definePipeline<JoinRequestEvent>()
    .withName(JOIN_REQUEST_PIPELINE_NAME)
    .withAggregateType(JOIN_REQUEST_AGGREGATE_TYPE)
    .withProjection(
      JOIN_REQUEST_PROJECTION_NAME,
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

/**
 * The two timers (D12): the day-7 reminder and the day-14 expiry, on ONE wake
 * column. PENDING → EXPIRED happens through this wake and nowhere else, and
 * the reminder is the only nudge admins ever get about a given request.
 *
 * Every ending disarms it, which is what makes "no reminder and no expiry
 * wake follows" true for a withdrawal rather than merely likely.
 *
 * The process holds two timestamps and a flag, and the events it reads are
 * ids, a domain and enums, so no content boundary is needed on the payload.
 */
function mountRequestLifecycle(
  pm: ProcessManagerInitialStage<JoinRequestEvent>,
  lifecycle: JoinRequestLifecyclePort,
) {
  return pm
    .state<JoinRequestLifecycleState>(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE)
    .intent(
      "remindAdmins",
      remindAdminsIntentSchema,
      runRemindAdmins({ port: lifecycle }),
    )
    .intent(
      "expireRequest",
      expireRequestIntentSchema,
      runExpireRequest({ port: lifecycle }),
    )
    .on(JOIN_REQUESTED_EVENT_TYPE, onJoinRequested)
    .on(JOIN_APPROVED_EVENT_TYPE, onJoinResolved)
    .on(JOIN_REJECTED_EVENT_TYPE, onJoinResolved)
    .on(JOIN_WITHDRAWN_EVENT_TYPE, onJoinResolved)
    .on(JOIN_EXPIRED_EVENT_TYPE, onJoinResolved)
    .onWake(joinRequestLifecycleWake);
}
