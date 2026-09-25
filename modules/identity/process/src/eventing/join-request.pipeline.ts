import {
  defineAggregate,
  type EventSourcing,
  definePipeline,
  type IntentSpec,
  type ProcessManagerHandledStage,
  type ProcessManagerInitialStage,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
  defineEventingModule,
  type EventingSetup,
} from "@langwatch/eventing";
import {
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_EXPIRED_EVENT_TYPE,
  JOIN_REJECTED_EVENT_TYPE,
  JOIN_REQUESTED_EVENT_TYPE,
  JOIN_WITHDRAWN_EVENT_TYPE,
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import type { ZodType } from "zod";

import type { IdentityApp } from "../app/identity.app.ts";
import type { JoinRequestMail } from "../app/identity.members.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import type { JoinRequestNotifier } from "../rules/join-requests-contract.rules.ts";
import { JoinRequestGuardsService } from "../services/join-request-guards.service.ts";
import { JoinRequestLifecycleDispatcherService } from "../services/join-request-lifecycle-dispatcher.service.ts";
import { JoinRequestNotificationService } from "../services/join-request-notification.service.ts";
import { JoinRequestService } from "../services/join-request.service.ts";
import { AppendingJoinRequestLedgerStore } from "./join-request-appending-ledger.store.ts";
import {
  runExpireRequest,
  runPrepareNotification,
  runRemindAdmins,
} from "./join-request-lifecycle.intent.ts";
import {
  expireRequestIntentSchema,
  JOIN_REQUEST_LIFECYCLE_INITIAL_STATE,
  JOIN_REQUEST_LIFECYCLE_PROCESS_NAME,
  type JoinRequestLifecycle,
  type JoinRequestLifecycleState,
  joinRequestLifecycleWake,
  joinRequestNotificationIntentSchema,
  onJoinApproved,
  onJoinExpired,
  onJoinRejected,
  onJoinRequested,
  onJoinResolved,
  remindAdminsIntentSchema,
} from "./join-request-lifecycle.process.ts";
import {
  type JoinRequestEvent,
  type JoinRequestFoldState,
  JoinRequestStateFoldProjection,
  joinRequestedEventSchema,
  joinApprovedEventSchema,
  joinRejectedEventSchema,
  joinExpiredEventSchema,
  joinWithdrawnEventSchema,
} from "./join-request-state.projection.ts";
import {
  ApproveJoinCommand,
  ExpireJoinCommand,
  RejectJoinCommand,
  RequestJoinCommand,
  WithdrawJoinCommand,
} from "./join-request.intent.ts";

export interface JoinRequestPipelineDeps {
  joinRequestProjectionStore: StateProjectionStore<JoinRequestFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-process`'s
   *  JoinRequestGuardsService over the app's projection reads, the same instance
   *  shape the calling path uses. */
  joinRequestGuards: JoinRequestGuardsService;
  /** How the reminder and expiry wakes reach the world. */
  lifecycle: JoinRequestLifecycle;
}

export type JoinRequestPipeline = StaticPipelineDefinition<
  JoinRequestEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/**
 * organization is the tenant. Commands append (waited) and the operational projection folds into
 * the Postgres `JoinRequest` head in per-request FIFO.
 * The join-request pipeline (D12, ADR-117). One aggregate per request; the
 */
export function defineJoinRequestPipeline(deps: JoinRequestPipelineDeps): JoinRequestPipeline {
  const builder = definePipeline({
    name: JOIN_REQUEST_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: JOIN_REQUEST_AGGREGATE_TYPE,
    }),
  })
    .withEvents([
      joinRequestedEventSchema,
      joinApprovedEventSchema,
      joinRejectedEventSchema,
      joinExpiredEventSchema,
      joinWithdrawnEventSchema,
    ])
    .withPostgresProjection(
      new JoinRequestStateFoldProjection({
        store: deps.joinRequestProjectionStore,
      }),
    )
    .withCommandInstance(
      "requestJoin",
      RequestJoinCommand,
      new RequestJoinCommand(deps.joinRequestGuards),
    )
    .withCommandInstance(
      "approveJoin",
      ApproveJoinCommand,
      new ApproveJoinCommand(deps.joinRequestGuards),
    )
    .withCommandInstance(
      "rejectJoin",
      RejectJoinCommand,
      new RejectJoinCommand(deps.joinRequestGuards),
    )
    .withCommandInstance(
      "withdrawJoin",
      WithdrawJoinCommand,
      new WithdrawJoinCommand(deps.joinRequestGuards),
    )
    .withCommandInstance(
      "expireJoin",
      ExpireJoinCommand,
      new ExpireJoinCommand(deps.joinRequestGuards),
    );

  return builder
    .withProcessManager(JOIN_REQUEST_LIFECYCLE_PROCESS_NAME, (pm) =>
      mountRequestLifecycle(pm, deps.lifecycle),
    )
    .build();
}

/**
 * The two timers (D12) on ONE wake column — PENDING → EXPIRED happens through this wake and
 * nowhere else — and every notice, derived from the fact it announces rather than handed over by
 * the service that recorded it, so the handoff cannot be lost between command and callback.
 */
function mountRequestLifecycle(
  pm: ProcessManagerInitialStage<JoinRequestEvent>,
  lifecycle: JoinRequestLifecycle,
): ProcessManagerHandledStage<
  JoinRequestEvent,
  JoinRequestLifecycleState,
  Record<string, IntentSpec<ZodType>>
> {
  return pm
    .state<JoinRequestLifecycleState>(JOIN_REQUEST_LIFECYCLE_INITIAL_STATE)
    .intent("remindAdmins", remindAdminsIntentSchema, runRemindAdmins({ port: lifecycle }))
    .intent("expireRequest", expireRequestIntentSchema, runExpireRequest({ port: lifecycle }))
    .intent(
      "prepareNotification",
      joinRequestNotificationIntentSchema,
      runPrepareNotification({ port: lifecycle }),
    )
    .on(JOIN_REQUESTED_EVENT_TYPE, onJoinRequested)
    .on(JOIN_APPROVED_EVENT_TYPE, onJoinApproved)
    .on(JOIN_REJECTED_EVENT_TYPE, onJoinRejected)
    .on(JOIN_WITHDRAWN_EVENT_TYPE, onJoinResolved)
    .on(JOIN_EXPIRED_EVENT_TYPE, onJoinExpired)
    .onWake(joinRequestLifecycleWake);
}

/** The join-request pipeline a draining process runs (D12, ADR-117): wakes expire and notify. */
export function composeJoinRequestPipeline(options: {
  repositories: Pick<IdentityRepositories, "joinRequestProjection" | "joinRequests">;
  eventSourcing: EventSourcing;
  notifier: JoinRequestNotifier;
}): JoinRequestPipeline {
  const { repositories, eventSourcing, notifier } = options;
  const head = repositories.joinRequestProjection;
  const reads = repositories.joinRequests;
  const guards = JoinRequestGuardsService.create({ requests: reads });
  const requests = JoinRequestService.create(
    guards,
    AppendingJoinRequestLedgerStore.forEventSourcing({ projectionStore: head, eventSourcing }),
  );
  return defineJoinRequestPipeline({
    joinRequestProjectionStore: head,
    joinRequestGuards: guards,
    lifecycle: JoinRequestLifecycleDispatcherService.create(reads, notifier, () => requests),
  });
}

/** The wake notifications: the audience is the module's rows, the mail the process's port. */
export function composeJoinRequestNotifications(options: {
  repositories: Pick<IdentityRepositories, "joinRequestAudience">;
  mail: JoinRequestMail;
}): JoinRequestNotificationService {
  return JoinRequestNotificationService.create({
    audience: options.repositories.joinRequestAudience,
    mail: options.mail,
  });
}

export const joinRequestEventing = defineEventingModule({
  pipeline: JOIN_REQUEST_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<IdentityRepositories, IdentityApp>) =>
    app.joinRequestPipeline({ participation }),
  connect: ({ app, commands }) =>
    app.connectPipeline({ pipeline: JOIN_REQUEST_PIPELINE_NAME, commands }),
});
