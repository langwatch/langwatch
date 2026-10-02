/**
 * @vitest-environment node
 * Web Push from notification's side: browsers stored per endpoint, one queued send per
 * browser, the encrypted and signed request, and what each push service answer does.
 * Spec: modules/notification/specs/web-push.feature
 */
import { createDecipheriv, createECDH, createHmac, randomBytes, type ECDH } from "node:crypto";

import { DispatchError, InMemoryProcessStore } from "@langwatch/eventing";
import {
  WebPushEndpointRefusedError,
  webPushSubscriptionInputSchema,
} from "@langwatch/notification-contract";
import { describe, expect, it } from "vitest";

import { MemoryWebPushGatewayChannel } from "../../channels/memory/memory.web-push-gateway.channel.ts";
import { OutboxWebPushQueue } from "../../eventing/web-push.pipeline.ts";
import { WEB_PUSH_PROCESS_NAME } from "../../eventing/web-push.process.ts";
import { MemoryWebPushSubscriptionRepository } from "../../repositories/memory/memory.web-push-subscription.repository.ts";
import { MemoryWebPushVapidKeyRepository } from "../../repositories/memory/memory.web-push-vapid-key.repository.ts";
import {
  vapidSubject,
  webPushTopicHeader,
  type VapidSettings,
} from "../../rules/web-push.rules.ts";
import { WebPushService, webPushSendSchema, type WebPushSend } from "../web-push.service.ts";

const PROJECT_ID = "project-acme";
const SETTINGS: VapidSettings = { publicBaseUrl: "https://app.acme.test" };

/** A browser's side of a push subscription: its key pair and auth secret. */
function browser(endpoint: string): {
  ecdh: ECDH;
  auth: Buffer;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    subscription: {
      endpoint,
      keys: {
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: auth.toString("base64url"),
      },
    },
  };
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Decrypts an aes128gcm push body the way the browser does (RFC 8188, RFC 8291). */
function decryptPush(body: Uint8Array, receiver: { ecdh: ECDH; auth: Buffer }): string {
  const bytes = Buffer.from(body);
  const salt = bytes.subarray(0, 16);
  const idLength = bytes.readUInt8(20);
  const senderPublic = bytes.subarray(21, 21 + idLength);
  const ciphertext = bytes.subarray(21 + idLength);
  const shared = receiver.ecdh.computeSecret(senderPublic);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    receiver.ecdh.getPublicKey(),
    senderPublic,
  ]);
  const ikm = hmac(hmac(receiver.auth, shared), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  return padded.subarray(0, padded.lastIndexOf(2)).toString("utf8");
}

function setup(settings: VapidSettings = SETTINGS) {
  const subscriptions = MemoryWebPushSubscriptionRepository.create();
  const vapidKeys = MemoryWebPushVapidKeyRepository.create();
  const gateway = MemoryWebPushGatewayChannel.create();
  const processStore = InMemoryProcessStore.createForTesting();
  const queue = OutboxWebPushQueue.create(processStore);
  const service = WebPushService.create({
    subscriptions,
    vapidKeys,
    gateway,
    settings,
    queue: () => queue,
  });
  return { service, subscriptions, vapidKeys, gateway, processStore };
}

const FCM = "https://fcm.googleapis.com/fcm/send/";

function sendFor(subscriptionId: string, overrides: Partial<WebPushSend> = {}): WebPushSend {
  return {
    subscriptionId,
    topic: webPushTopicHeader("langy:conversation-1"),
    urgency: "high",
    ttlSeconds: 86_400,
    message: {
      title: "Langy finished",
      body: 'Done with "Weekly costs".',
      url: "/acme?langyConversation=conversation-1",
      tag: "langy:conversation-1",
    },
    ...overrides,
  };
}

async function queuedSends(processStore: InMemoryProcessStore, userId: string) {
  return processStore.findMessagesByRef({
    ref: {
      processName: WEB_PUSH_PROCESS_NAME,
      projectId: PROJECT_ID,
      processKey: `user:${userId}`,
    },
  });
}

describe("given a person subscribing browsers", () => {
  /** @scenario "An endpoint that is not https is refused" */
  it("refuses an endpoint that is not https", () => {
    const { subscription } = browser("http://fcm.googleapis.com/fcm/send/1");

    expect(webPushSubscriptionInputSchema.validate(subscription)).toBe(false);
  });

  /** @scenario "An endpoint off the browser push services is refused" */
  it("refuses an endpoint off the browser push services and stores nothing", async () => {
    const { service, subscriptions } = setup();

    await expect(
      service.subscribe({
        userId: "ada",
        subscription: browser("https://push.acme.test/send/1").subscription,
      }),
    ).rejects.toBeInstanceOf(WebPushEndpointRefusedError);
    await expect(subscriptions.findByUser("ada")).resolves.toEqual([]);
  });
});

describe("given a person subscribed on two browsers", () => {
  async function twoBrowsers() {
    const context = setup();
    await context.service.subscribe({
      userId: "ada",
      subscription: browser(`${FCM}laptop`).subscription,
    });
    await context.service.subscribe({
      userId: "ada",
      subscription: browser("https://updates.push.services.mozilla.com/wpush/v2/phone")
        .subscription,
    });
    return context;
  }

  const request = {
    userId: "ada",
    projectId: PROJECT_ID,
    idempotencyKey: "event-1",
    topic: "langy:conversation-1",
    message: sendFor("unused").message,
  };

  /** @scenario "A push request queues one send per device" */
  it("queues one send for each browser", async () => {
    const { service, processStore } = await twoBrowsers();

    await expect(service.request(request)).resolves.toEqual({ queued: 2 });

    const rows = await queuedSends(processStore, "ada");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.intentType)).toEqual(["send", "send"]);
  });

  /** @scenario "The same request asked twice queues nothing new" */
  it("queues nothing new for the same idempotency key", async () => {
    const { service, processStore } = await twoBrowsers();

    await service.request(request);
    await expect(service.request(request)).resolves.toEqual({ queued: 0 });
    expect(await queuedSends(processStore, "ada")).toHaveLength(2);
  });

  /** @scenario "Two devices of the same person each get one push, even for a redelivered event" */
  it("delivers exactly one push to each browser when the same event arrives twice", async () => {
    const { service, processStore, gateway } = await twoBrowsers();

    await service.request(request);
    await service.request(request);
    for (const row of await queuedSends(processStore, "ada")) {
      await service.send(webPushSendSchema.parse(row.payload));
    }

    expect(gateway.sent.map((sent) => sent.endpoint).toSorted()).toEqual([
      `${FCM}laptop`,
      "https://updates.push.services.mozilla.com/wpush/v2/phone",
    ]);
  });

  /** @scenario "A deactivated person's devices are removed" */
  it("removes every browser when the person leaves", async () => {
    const { service, subscriptions } = await twoBrowsers();

    await service.forgetPerson("ada");

    await expect(subscriptions.findByUser("ada")).resolves.toEqual([]);
  });
});

describe("given a person who never subscribed a browser", () => {
  /** @scenario "A person with no device queues nothing" */
  it("queues nothing", async () => {
    const { service, processStore } = setup();

    await expect(
      service.request({
        userId: "grace",
        projectId: PROJECT_ID,
        idempotencyKey: "event-1",
        topic: "langy:conversation-1",
        message: sendFor("unused").message,
      }),
    ).resolves.toEqual({ queued: 0 });
    expect(await queuedSends(processStore, "grace")).toEqual([]);
  });
});

describe("given a subscribed browser", () => {
  async function subscribed() {
    const context = setup();
    const receiver = browser(`${FCM}laptop`);
    await context.service.subscribe({ userId: "ada", subscription: receiver.subscription });
    const [row] = await context.subscriptions.findByUser("ada");
    if (!row) throw new Error("the browser was not stored");
    return { ...context, receiver, subscriptionId: row.id };
  }

  /** @scenario "A send carries the payload encrypted, a day's TTL, high urgency and a topic" */
  it("posts an aes128gcm body the browser decrypts, signed, with TTL, urgency and topic", async () => {
    const { service, gateway, receiver, subscriptionId } = await subscribed();
    const send = sendFor(subscriptionId);

    await service.send(send);

    const [posted] = gateway.sent;
    expect(posted?.endpoint).toBe(`${FCM}laptop`);
    expect(JSON.parse(decryptPush(posted!.body, receiver))).toEqual(send.message);
    expect(posted?.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Urgency: "high",
      Topic: send.topic,
    });
    const { publicKey } = await service.getPublicKey();
    expect(posted?.headers.Authorization).toMatch(new RegExp(`^vapid t=.+, k=${publicKey}$`));
  });

  /** @scenario "A newer push about the same subject replaces the older one" */
  it("gives one subject one topic header of at most 32 URL-safe characters", () => {
    const topic = webPushTopicHeader("langy:conversation-with-a-long-identifier-1234567890");

    expect(topic).toBe(webPushTopicHeader("langy:conversation-with-a-long-identifier-1234567890"));
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(topic).not.toBe(webPushTopicHeader("langy:another-conversation"));
  });

  /** @scenario "A delivered push records the device's last success" */
  it("records the last success when the service answers 201", async () => {
    const { service, subscriptions, subscriptionId } = await subscribed();

    await service.send(sendFor(subscriptionId));

    const row = await subscriptions.findById(subscriptionId);
    expect(row?.lastSuccessAt).toBeInstanceOf(Date);
  });

  /** @scenario "A device the push service no longer knows is deleted" */
  it.each([404, 410])("deletes the browser and does not retry on %i", async (status) => {
    const { service, gateway, subscriptions, subscriptionId } = await subscribed();
    gateway.answerWith({ status });

    await expect(service.send(sendFor(subscriptionId))).resolves.toBeUndefined();

    await expect(subscriptions.findById(subscriptionId)).resolves.toBeNull();
  });

  /** @scenario "A busy or failing push service is retried with backoff" */
  it("retries a 429 no sooner than its Retry-After, and a 5xx", async () => {
    const { service, gateway, subscriptionId } = await subscribed();
    gateway.answerWith({ status: 429, retryAfterMs: 120_000 }, { status: 503 });

    const busy = await service.send(sendFor(subscriptionId)).catch((error: unknown) => error);
    const failing = await service.send(sendFor(subscriptionId)).catch((error: unknown) => error);

    expect(busy).toBeInstanceOf(DispatchError);
    expect(busy).toMatchObject({ retryable: true, retryAfterMs: 120_000 });
    expect(failing).toMatchObject({ retryable: true });
  });

  /** @scenario "A push the service refuses for good is not retried" */
  it("ends without a retry on a 400 and keeps the browser", async () => {
    const { service, gateway, subscriptions, subscriptionId } = await subscribed();
    gateway.answerWith({ status: 400 });

    await expect(service.send(sendFor(subscriptionId))).rejects.toMatchObject({
      retryable: false,
    });
    await expect(subscriptions.findById(subscriptionId)).resolves.not.toBeNull();
  });

  /** @scenario "A push service that cannot be reached is retried" */
  it("lets a retryable network failure through to the outbox", async () => {
    const { service, gateway, subscriptionId } = await subscribed();
    gateway.answerWith(new DispatchError({ message: "Connection timed out", retryable: true }));

    await expect(service.send(sendFor(subscriptionId))).rejects.toMatchObject({
      retryable: true,
    });
  });

  /** @scenario "A device deleted before its send is skipped" */
  it("sends nothing to a browser deleted before its send ran", async () => {
    const { service, gateway, subscriptions, subscriptionId } = await subscribed();
    await subscriptions.deleteById(subscriptionId);

    await service.send(sendFor(subscriptionId));

    expect(gateway.sent).toEqual([]);
  });
});

describe("given an installation with no VAPID key pair stored", () => {
  /** @scenario "The first use generates the installation's VAPID key pair and stores it encrypted" */
  it("generates a P-256 pair on first use and answers its stored public key", async () => {
    const { service, vapidKeys } = setup();

    const { publicKey } = await service.getPublicKey();

    const stored = await vapidKeys.find();
    expect(stored?.publicKey).toBe(publicKey);
    expect(Buffer.from(publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(stored!.privateKey, "base64url")).toHaveLength(32);
  });

  /** @scenario "A later process reads the stored pair instead of generating" */
  it("reads the stored pair in a later process", async () => {
    const first = setup();
    const { publicKey } = await first.service.getPublicKey();
    const later = WebPushService.create({
      subscriptions: first.subscriptions,
      vapidKeys: first.vapidKeys,
      gateway: first.gateway,
      settings: SETTINGS,
      queue: () => undefined,
    });

    await expect(later.getPublicKey()).resolves.toEqual({ publicKey });
  });
});

describe("the VAPID contact", () => {
  it("is the installation's https origin, else the vendor's site", () => {
    expect(vapidSubject({ publicBaseUrl: "https://app.acme.test/base" })).toBe(
      "https://app.acme.test",
    );
    expect(vapidSubject({ publicBaseUrl: "http://localhost:5560" })).toBe("https://langwatch.ai");
  });
});
