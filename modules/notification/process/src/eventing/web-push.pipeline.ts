/**
 * Web Push sending (ADR-167): sends wait in the outbox, retried with backoff, and a person's
 * browsers leave with the person. Spec: modules/notification/specs/web-push.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type ProcessStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { USER_ERASED_EVENT_TYPE, userErasedPayloadSchema } from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";
import {
  USER_DEACTIVATED_EVENT_TYPE,
  userLifecycleEventDataSchema,
} from "@langwatch/user-contract";

import type { NotificationModule } from "../app/notification.app.ts";
import type { NotificationRepositories } from "../repositories/notification.repositories.ts";
import {
  webPushSendSchema,
  type WebPushQueue,
  type WebPushService,
} from "../services/web-push.service.ts";
import {
  WEB_PUSH_INITIAL_STATE,
  WEB_PUSH_OUTBOX_RETENTION_MS,
  WEB_PUSH_PROCESS_NAME,
  WEB_PUSH_PRUNE_INTERVAL_MS,
  WEB_PUSH_SEND_INTENT,
  webPushProcessKey,
  webPushProcessStateSchema,
  webPushPruneSchema,
  webPushPruneWake,
} from "./web-push.process.ts";

const WEB_PUSH_PIPELINE_NAME = "notification_web_push" as const;

/** A push that cannot go out in about a day is not worth sending: the TTL has lapsed. */
const WEB_PUSH_MAX_ATTEMPTS = 8;

/** 5s, 10s, 20s ... capped at 15 minutes; a `Retry-After` can only lengthen it. */
export function webPushRetryDelayMs({ attempt }: { attempt: number }): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 15 * 60 * 1000);
}

/** The outbox, as Web Push's queue: one idempotent row per send. */
export class OutboxWebPushQueue implements WebPushQueue {
  static create(processStore: ProcessStore): OutboxWebPushQueue {
    return new OutboxWebPushQueue(processStore);
  }

  private constructor(private readonly processStore: ProcessStore) {}

  async enqueue({
    userId,
    projectId,
    sends,
  }: Parameters<WebPushQueue["enqueue"]>[0]): Promise<{ queued: number }> {
    const result = await this.processStore.appendIntents({
      ref: { processName: WEB_PUSH_PROCESS_NAME, projectId, processKey: webPushProcessKey(userId) },
      tenantId: projectId,
      userId,
      sourceEventId: null,
      messages: sends.map(({ messageKey, send }) => ({
        messageKey,
        intentType: WEB_PUSH_SEND_INTENT,
        payload: send,
        traceCarrier: {},
      })),
      now: nowInstant().epochMilliseconds,
    });
    return { queued: result.insertedMessageKeys.length };
  }
}

interface WebPushPipelineDeps {
  webPush: WebPushService;
  processStore: ProcessStore;
}

export type WebPushPipeline = StaticPipelineDefinition<never>;

export function buildWebPushPipeline({
  webPush,
  processStore,
}: WebPushPipelineDeps): WebPushPipeline {
  return (
    definePipeline({
      name: WEB_PUSH_PIPELINE_NAME,
      // `global`: this appends no events of its own; the sends ride the outbox.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      .withProcessManager(WEB_PUSH_PROCESS_NAME, (pm) =>
        pm
          .state(webPushProcessStateSchema, WEB_PUSH_INITIAL_STATE)
          .intent(WEB_PUSH_SEND_INTENT, webPushSendSchema, (send) => webPush.send(send))
          .intent("prune", webPushPruneSchema, async () => {
            await processStore.deleteDispatchedBefore({
              processName: WEB_PUSH_PROCESS_NAME,
              before: nowInstant().epochMilliseconds - WEB_PUSH_OUTBOX_RETENTION_MS,
            });
          })
          .schedule({ everyMs: WEB_PUSH_PRUNE_INTERVAL_MS })
          .onWake(webPushPruneWake)
          .outbox({
            maxAttempts: WEB_PUSH_MAX_ATTEMPTS,
            retryDelayMs: webPushRetryDelayMs,
            concurrency: 8,
          }),
      )
      // Who left is user's and identity's fact; notification removes its own rows (§9).
      .withPeerSubscriber("webPushUserDeactivated", {
        eventType: USER_DEACTIVATED_EVENT_TYPE,
        data: userLifecycleEventDataSchema,
        handle: ({ userId }) => webPush.forgetPerson(userId),
      })
      .withPeerSubscriber("webPushUserErased", {
        eventType: USER_ERASED_EVENT_TYPE,
        data: userErasedPayloadSchema,
        handle: ({ userId }) => webPush.forgetPerson(userId),
      })
      .build()
  );
}

export const webPushEventing = defineEventingModule({
  pipeline: WEB_PUSH_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<NotificationRepositories, NotificationModule>) =>
    app.webPushPipeline({ processStore }),
});
