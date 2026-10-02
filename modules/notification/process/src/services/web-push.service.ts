/**
 * Web Push, notification's side (ADR-167): the browsers people subscribed, this
 * installation's VAPID key pair, and the one send the outbox retries.
 * Spec: modules/notification/specs/web-push.feature
 */
import { DispatchError } from "@langwatch/eventing";
import {
  requestWebPushDeliveryCommandSchema,
  subscribeWebPushCommandSchema,
  unsubscribeWebPushCommandSchema,
  WEB_PUSH_DEFAULT_TTL_SECONDS,
  webPushPayloadSchema,
  WebPushEndpointRefusedError,
  type RequestWebPushDeliveryCommand,
  type SubscribeWebPushCommand,
  type UnsubscribeWebPushCommand,
  type WebPushDeliveryRequested,
  type WebPushPublicKey,
} from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import webpush from "web-push";
import { z } from "zod";

import type { WebPushGateway } from "../channels/web-push-gateway.channel.ts";
import type { WebPushSubscriptionRepository } from "../repositories/web-push-subscription.repository.ts";
import type {
  VapidKeyPair,
  WebPushVapidKeyRepository,
} from "../repositories/web-push-vapid-key.repository.ts";
import {
  classifyWebPushAnswer,
  isKnownPushServiceEndpoint,
  vapidSubject,
  webPushTopicHeader,
  type VapidSettings,
} from "../rules/web-push.rules.ts";

const logger = createLogger("langwatch:notification:web-push");

/** The intent the outbox runs: one push to one browser. */
export const webPushSendSchema = z
  .object({
    subscriptionId: z.string().min(1),
    topic: z.string().min(1).max(32),
    urgency: z.enum(["very-low", "low", "normal", "high"]),
    ttlSeconds: z.number().int().min(0),
    message: webPushPayloadSchema,
  })
  .strict();

export type WebPushSend = z.infer<typeof webPushSendSchema>;

/** One queued send, keyed so a second request for the same fact and browser is a duplicate. */
export interface WebPushQueuedSend {
  messageKey: string;
  send: WebPushSend;
}

/** Where sends wait for the worker: the framework outbox, behind notification's process. */
export interface WebPushQueue {
  enqueue(input: {
    userId: string;
    projectId: string;
    sends: readonly WebPushQueuedSend[];
  }): Promise<{ queued: number }>;
}

export interface WebPushServiceDeps {
  subscriptions: WebPushSubscriptionRepository;
  vapidKeys: WebPushVapidKeyRepository;
  gateway: WebPushGateway;
  settings: VapidSettings;
  /** Absent in a process that does not run notification's pipeline. */
  queue: () => WebPushQueue | undefined;
}

export class WebPushService {
  #pair: Promise<VapidKeyPair> | null = null;

  private constructor(private readonly deps: WebPushServiceDeps) {}

  static create(deps: WebPushServiceDeps): WebPushService {
    return new WebPushService(deps);
  }

  /**
   * This installation's pair: the stored one, else a new one stored for every process of
   * the installation. One code path for every deployment. Read once per process.
   */
  vapidKeyPair(): Promise<VapidKeyPair> {
    this.#pair ??= this.#resolvePair().catch((error: unknown) => {
      this.#pair = null;
      throw error;
    });
    return this.#pair;
  }

  async #resolvePair(): Promise<VapidKeyPair> {
    const stored = await this.deps.vapidKeys.find();
    if (stored) return stored;
    const generated = webpush.generateVAPIDKeys();
    const winner = await this.deps.vapidKeys.insertIfAbsent(generated);
    logger.info("Generated this installation's Web Push VAPID key pair");
    return winner;
  }

  async getPublicKey(): Promise<WebPushPublicKey> {
    const { publicKey } = await this.vapidKeyPair();
    return { publicKey };
  }

  async subscribe(input: SubscribeWebPushCommand): Promise<void> {
    const command = subscribeWebPushCommandSchema.parse(input);
    if (!isKnownPushServiceEndpoint(command.subscription.endpoint)) {
      throw new WebPushEndpointRefusedError();
    }
    await this.deps.subscriptions.upsert({
      userId: command.userId,
      endpoint: command.subscription.endpoint,
      p256dh: command.subscription.keys.p256dh,
      auth: command.subscription.keys.auth,
      userAgent: command.userAgent ?? null,
    });
  }

  async unsubscribe(input: UnsubscribeWebPushCommand): Promise<void> {
    const command = unsubscribeWebPushCommandSchema.parse(input);
    await this.deps.subscriptions.deleteForUser(command);
  }

  async forgetPerson(userId: string): Promise<void> {
    const removed = await this.deps.subscriptions.deleteAllForUser(userId);
    if (removed > 0) logger.info({ removed }, "Removed the Web Push browsers of a person who left");
  }

  /** Queues one send per browser the person subscribed; the worker does the sending. */
  async request(input: RequestWebPushDeliveryCommand): Promise<WebPushDeliveryRequested> {
    const command = requestWebPushDeliveryCommandSchema.parse(input);
    const browsers = await this.deps.subscriptions.findByUser(command.userId);
    if (browsers.length === 0) return { queued: 0 };
    const queue = this.deps.queue();
    if (!queue) throw new Error("notification_web_push is not registered in this process");
    const topic = webPushTopicHeader(command.topic);
    return queue.enqueue({
      userId: command.userId,
      projectId: command.projectId,
      sends: browsers.map((browser) => ({
        messageKey: `push:${command.idempotencyKey}:${browser.id}`,
        send: {
          subscriptionId: browser.id,
          topic,
          urgency: command.urgency,
          ttlSeconds: command.ttlSeconds ?? WEB_PUSH_DEFAULT_TTL_SECONDS,
          message: command.message,
        },
      })),
    });
  }

  /**
   * One push to one browser. Returns when the push service took it, or when the browser is
   * gone for good; throws a `DispatchError` the outbox retries or retires.
   */
  async send(input: WebPushSend): Promise<void> {
    const browser = await this.deps.subscriptions.findById(input.subscriptionId);
    if (!browser) return;
    const pair = await this.vapidKeyPair();
    const details = webpush.generateRequestDetails(
      { endpoint: browser.endpoint, keys: { p256dh: browser.p256dh, auth: browser.auth } },
      JSON.stringify(input.message),
      {
        vapidDetails: {
          subject: vapidSubject(this.deps.settings),
          publicKey: pair.publicKey,
          privateKey: pair.privateKey,
        },
        TTL: input.ttlSeconds,
        urgency: input.urgency,
        topic: input.topic,
        contentEncoding: "aes128gcm",
      },
    );
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(details.headers)) {
      headers[name] = String(value);
    }
    const response = await this.deps.gateway.send({
      endpoint: details.endpoint,
      headers,
      body: new Uint8Array(details.body ?? Buffer.alloc(0)),
    });
    const answer = classifyWebPushAnswer(response);
    switch (answer.outcome) {
      case "delivered":
        await this.deps.subscriptions.recordSuccess({ id: browser.id, at: nowInstant() });
        return;
      case "gone":
        await this.deps.subscriptions.deleteById(browser.id);
        logger.info(
          { status: response.status },
          "The push service no longer knows this browser; removed its subscription",
        );
        return;
      case "retry":
        throw new DispatchError({
          message: `Web Push: the push service answered ${response.status}`,
          retryable: true,
          ...(answer.retryAfterMs === undefined ? {} : { retryAfterMs: answer.retryAfterMs }),
        });
      case "refused":
        throw new DispatchError({
          message: `Web Push: the push service refused the push with ${response.status}`,
          retryable: false,
        });
    }
  }
}
